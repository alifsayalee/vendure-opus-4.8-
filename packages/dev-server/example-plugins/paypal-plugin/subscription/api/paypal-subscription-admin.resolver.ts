import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, UserInputError } from '@vendure/core';

import { PayPalSubscription } from '../paypal-subscription.entity';
import { PayPalSubscriptionService } from '../paypal-subscription.service';
import {
    CreateBillingPlanResult,
    PayPalIntervalUnit,
    PayPalSubscriptionStatus,
} from '../subscription-types';

interface CreateBillingPlanArgs {
    input: {
        productId: string;
        name: string;
        description?: string;
        amount: number;
        currencyCode: string;
        intervalUnit: PayPalIntervalUnit;
        intervalCount: number;
        totalCycles?: number;
        paymentFailureThreshold?: number;
        activateImmediately?: boolean;
    };
}

@Resolver()
export class PayPalSubscriptionAdminResolver {
    constructor(private readonly subscriptionService: PayPalSubscriptionService) {}

    @Query()
    @Allow(Permission.ReadPaymentMethod)
    async payPalSubscriptions(
        @Ctx() ctx: RequestContext,
        @Args() args: { skip?: number; take?: number; status?: PayPalSubscriptionStatus },
    ): Promise<{ items: PayPalSubscription[]; totalItems: number }> {
        return this.subscriptionService.findAll(ctx, {
            skip: args.skip,
            take: args.take,
            status: args.status,
        });
    }

    @Query()
    @Allow(Permission.ReadPaymentMethod)
    async payPalSubscription(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID },
    ): Promise<PayPalSubscription | null> {
        return this.subscriptionService.findOne(ctx, args.id);
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    async createPayPalBillingPlan(
        @Ctx() ctx: RequestContext,
        @Args() args: CreateBillingPlanArgs,
    ): Promise<CreateBillingPlanResult> {
        const { amount, ...rest } = args.input;
        return this.subscriptionService.createBillingPlan(ctx, {
            ...rest,
            amountMinorUnits: amount,
        });
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    async activatePayPalBillingPlan(
        @Ctx() ctx: RequestContext,
        @Args() args: { planId: string },
    ): Promise<boolean> {
        await this.subscriptionService.activateBillingPlan(ctx, args.planId);
        return true;
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    async deactivatePayPalBillingPlan(
        @Ctx() ctx: RequestContext,
        @Args() args: { planId: string },
    ): Promise<boolean> {
        await this.subscriptionService.deactivateBillingPlan(ctx, args.planId);
        return true;
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    async updatePayPalBillingPlanPricing(
        @Ctx() ctx: RequestContext,
        @Args() args: { planId: string; amount: number; currencyCode: string },
    ): Promise<boolean> {
        await this.subscriptionService.updatePlanPricing(
            ctx,
            args.planId,
            args.amount,
            args.currencyCode,
        );
        return true;
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    async updatePayPalBillingPlanFailureThreshold(
        @Ctx() ctx: RequestContext,
        @Args() args: { planId: string; threshold: number },
    ): Promise<boolean> {
        await this.subscriptionService.updatePlanPaymentFailureThreshold(
            ctx,
            args.planId,
            args.threshold,
        );
        return true;
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    async createPayPalSubscription(
        @Ctx() ctx: RequestContext,
        @Args() args: { planId: string },
    ): Promise<PayPalSubscription> {
        const { subscription } = await this.subscriptionService.createSubscription(ctx, args.planId);
        return subscription;
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    async syncPayPalSubscription(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID },
    ): Promise<PayPalSubscription> {
        return this.subscriptionService.sync(ctx, await this.getOrThrow(ctx, args.id));
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    async cancelPayPalSubscription(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID; reason: string },
    ): Promise<PayPalSubscription> {
        return this.subscriptionService.cancel(ctx, await this.getOrThrow(ctx, args.id), args.reason);
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    async suspendPayPalSubscription(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID; reason: string },
    ): Promise<PayPalSubscription> {
        return this.subscriptionService.suspend(ctx, await this.getOrThrow(ctx, args.id), args.reason);
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    async activatePayPalSubscription(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID; reason: string },
    ): Promise<PayPalSubscription> {
        return this.subscriptionService.activate(ctx, await this.getOrThrow(ctx, args.id), args.reason);
    }

    @Mutation()
    @Allow(Permission.UpdatePaymentMethod)
    async retryPayPalSubscriptionPayment(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID; amount: number; currencyCode: string; note: string },
    ): Promise<PayPalSubscription> {
        return this.subscriptionService.retryPayment(
            ctx,
            await this.getOrThrow(ctx, args.id),
            args.amount,
            args.currencyCode,
            args.note,
        );
    }

    private async getOrThrow(ctx: RequestContext, id: ID): Promise<PayPalSubscription> {
        const subscription = await this.subscriptionService.findOne(ctx, id);
        if (!subscription) {
            throw new UserInputError(`No PayPal subscription found with id "${id}"`);
        }
        return subscription;
    }
}
