import { Injectable } from '@nestjs/common';
import {
    CustomerService,
    ID,
    Logger,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { randomUUID } from 'crypto';

import { loggerCtx } from '../constants';
import { PayPalService } from '../paypal.service';
import { PayPalSubscription } from './paypal-subscription.entity';
import {
    CreateBillingPlanInput,
    CreateBillingPlanResult,
    PayPalSubscriptionStatus,
    TERMINAL_SUBSCRIPTION_STATUSES,
} from './subscription-types';

const KNOWN_STATUSES: PayPalSubscriptionStatus[] = [
    'APPROVAL_PENDING',
    'APPROVED',
    'ACTIVE',
    'SUSPENDED',
    'CANCELLED',
    'EXPIRED',
];

function normalizeStatus(status: string): PayPalSubscriptionStatus {
    return (KNOWN_STATUSES as string[]).includes(status)
        ? (status as PayPalSubscriptionStatus)
        : 'APPROVAL_PENDING';
}

/**
 * @description
 * Business logic for PayPal subscriptions (Use Case 6). Persists a local
 * {@link PayPalSubscription} mirror for each subscription created through
 * Vendure and orchestrates the PayPal SDK operations exposed by
 * {@link PayPalService}.
 */
@Injectable()
export class PayPalSubscriptionService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly customerService: CustomerService,
        private readonly payPalService: PayPalService,
    ) {}

    // --- Billing plan lifecycle (merchant) ---------------------------------

    createBillingPlan(
        ctx: RequestContext,
        input: CreateBillingPlanInput,
    ): Promise<CreateBillingPlanResult> {
        return this.payPalService.createBillingPlan(input, `plan-${randomUUID()}`);
    }

    activateBillingPlan(ctx: RequestContext, planId: string): Promise<void> {
        return this.payPalService.activateBillingPlan(planId);
    }

    deactivateBillingPlan(ctx: RequestContext, planId: string): Promise<void> {
        return this.payPalService.deactivateBillingPlan(planId);
    }

    updatePlanPricing(
        ctx: RequestContext,
        planId: string,
        amountMinorUnits: number,
        currencyCode: string,
    ): Promise<void> {
        return this.payPalService.updatePlanPricing(planId, amountMinorUnits, currencyCode);
    }

    updatePlanPaymentFailureThreshold(
        ctx: RequestContext,
        planId: string,
        threshold: number,
    ): Promise<void> {
        return this.payPalService.updatePlanPaymentFailureThreshold(planId, threshold);
    }

    // --- Subscription lifecycle --------------------------------------------

    /**
     * Creates a subscription, persists a local mirror, and returns it together
     * with the buyer approval URL. If a customer is logged in, the subscription
     * is linked to them.
     */
    async createSubscription(
        ctx: RequestContext,
        planId: string,
        brandName?: string,
    ): Promise<{ subscription: PayPalSubscription; approvalUrl?: string }> {
        const result = await this.payPalService.createSubscription(
            { planId, brandName },
            `sub-${randomUUID()}`,
        );

        let customerId: ID | null = null;
        if (ctx.activeUserId) {
            const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
            customerId = customer?.id ?? null;
        }

        const subscription = await this.connection.getRepository(ctx, PayPalSubscription).save(
            new PayPalSubscription({
                paypalSubscriptionId: result.subscriptionId,
                planId: result.planId ?? planId,
                status: normalizeStatus(result.status),
                customerId,
                approvalUrl: result.approvalUrl ?? null,
                lastSyncedAt: null,
            }),
        );
        Logger.info(
            `Created PayPal subscription ${result.subscriptionId} (plan ${planId}, status ${result.status})`,
            loggerCtx,
        );
        return { subscription, approvalUrl: result.approvalUrl };
    }

    async findOne(ctx: RequestContext, id: ID): Promise<PayPalSubscription | null> {
        return this.connection.getRepository(ctx, PayPalSubscription).findOne({ where: { id } });
    }

    async findByPayPalId(
        ctx: RequestContext,
        paypalSubscriptionId: string,
    ): Promise<PayPalSubscription | null> {
        return this.connection
            .getRepository(ctx, PayPalSubscription)
            .findOne({ where: { paypalSubscriptionId } });
    }

    /** Paginated list of local subscriptions, optionally filtered by status. */
    async findAll(
        ctx: RequestContext,
        options?: { skip?: number; take?: number; status?: PayPalSubscriptionStatus },
    ): Promise<{ items: PayPalSubscription[]; totalItems: number }> {
        const take = Math.min(options?.take ?? 25, 100);
        const skip = options?.skip ?? 0;
        const [items, totalItems] = await this.connection
            .getRepository(ctx, PayPalSubscription)
            .findAndCount({
                where: options?.status ? { status: options.status } : {},
                order: { createdAt: 'DESC' },
                skip,
                take,
            });
        return { items, totalItems };
    }

    /** All subscriptions belonging to a given Vendure customer. */
    async findByCustomer(ctx: RequestContext, customerId: ID): Promise<PayPalSubscription[]> {
        return this.connection.getRepository(ctx, PayPalSubscription).find({
            where: { customerId },
            order: { createdAt: 'DESC' },
        });
    }

    /** Fetches the live PayPal status and updates the local mirror. */
    async sync(ctx: RequestContext, subscription: PayPalSubscription): Promise<PayPalSubscription> {
        const result = await this.payPalService.getSubscription(subscription.paypalSubscriptionId);
        subscription.status = normalizeStatus(result.status);
        subscription.lastSyncedAt = new Date();
        return this.connection.getRepository(ctx, PayPalSubscription).save(subscription);
    }

    async cancel(
        ctx: RequestContext,
        subscription: PayPalSubscription,
        reason: string,
    ): Promise<PayPalSubscription> {
        await this.payPalService.cancelSubscription(subscription.paypalSubscriptionId, reason);
        subscription.status = 'CANCELLED';
        subscription.lastSyncedAt = new Date();
        return this.connection.getRepository(ctx, PayPalSubscription).save(subscription);
    }

    async suspend(
        ctx: RequestContext,
        subscription: PayPalSubscription,
        reason: string,
    ): Promise<PayPalSubscription> {
        await this.payPalService.suspendSubscription(subscription.paypalSubscriptionId, reason);
        return this.sync(ctx, subscription);
    }

    async activate(
        ctx: RequestContext,
        subscription: PayPalSubscription,
        reason: string,
    ): Promise<PayPalSubscription> {
        await this.payPalService.activateSubscription(subscription.paypalSubscriptionId, reason);
        return this.sync(ctx, subscription);
    }

    /** Retries a failed subscription payment by charging the outstanding balance. */
    async retryPayment(
        ctx: RequestContext,
        subscription: PayPalSubscription,
        amountMinorUnits: number,
        currencyCode: string,
        note: string,
    ): Promise<PayPalSubscription> {
        await this.payPalService.captureSubscriptionPayment(
            subscription.paypalSubscriptionId,
            amountMinorUnits,
            currencyCode,
            note,
        );
        return this.sync(ctx, subscription);
    }

    /** Resolves the Vendure customer id for the active session, if any. */
    async getActiveCustomerId(ctx: RequestContext): Promise<ID | undefined> {
        if (!ctx.activeUserId) {
            return undefined;
        }
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        return customer?.id;
    }

    /**
     * Reconciles the status of every non-terminal local subscription with
     * PayPal. Invoked by the scheduled task.
     */
    async syncAllActive(ctx: RequestContext): Promise<number> {
        const repo = this.connection.getRepository(ctx, PayPalSubscription);
        const candidates = await repo.find();
        const toSync = candidates.filter(
            s => !TERMINAL_SUBSCRIPTION_STATUSES.includes(s.status),
        );
        let synced = 0;
        for (const subscription of toSync) {
            try {
                await this.sync(ctx, subscription);
                synced++;
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                Logger.warn(
                    `Failed to sync PayPal subscription ${subscription.paypalSubscriptionId}: ${message}`,
                    loggerCtx,
                );
            }
        }
        return synced;
    }
}
