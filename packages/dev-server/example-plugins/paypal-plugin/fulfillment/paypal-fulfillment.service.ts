import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
    EventBus,
    FulfillmentLine,
    FulfillmentStateTransitionEvent,
    ID,
    Logger,
    Order,
    OrderService,
    Payment,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { Subscription } from 'rxjs';

import {
    loggerCtx,
    PAYPAL_AUTHORIZE_PAYMENT_METHOD_CODE,
    PAYPAL_PAYMENT_METHOD_CODE,
} from '../constants';
import { PayPalService } from '../paypal.service';

/** The fulfillment state at which tracking is pushed to PayPal. */
const TRACKED_STATE = 'Shipped';

const PAYPAL_METHOD_CODES = [PAYPAL_PAYMENT_METHOD_CODE, PAYPAL_AUTHORIZE_PAYMENT_METHOD_CODE];

interface PayPalPaymentMetadata {
    paypalOrderId?: string;
    captureId?: string;
}

/**
 * @description
 * Listens for fulfillment state transitions and, when a fulfillment is shipped,
 * pushes the carrier + tracking number to PayPal for each related order paid via
 * PayPal (Use Case 8). Failures are logged and never interrupt the fulfillment
 * flow.
 */
@Injectable()
export class PayPalFulfillmentService implements OnApplicationBootstrap, OnModuleDestroy {
    private subscription?: Subscription;

    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly orderService: OrderService,
        private readonly payPalService: PayPalService,
    ) {}

    onApplicationBootstrap(): void {
        this.subscription = this.eventBus
            .ofType(FulfillmentStateTransitionEvent)
            .subscribe(event => {
                if (event.toState === TRACKED_STATE) {
                    void this.pushTracking(event).catch(e => {
                        const message = e instanceof Error ? e.message : String(e);
                        Logger.error(`Failed to push PayPal tracking: ${message}`, loggerCtx);
                    });
                }
            });
    }

    onModuleDestroy(): void {
        this.subscription?.unsubscribe();
    }

    private async pushTracking(event: FulfillmentStateTransitionEvent): Promise<void> {
        const { ctx, fulfillment } = event;
        const orders = await this.getOrdersForFulfillment(ctx, fulfillment.id);

        for (const order of orders) {
            const payment = await this.findPayPalPayment(ctx, order.id);
            if (!payment) {
                continue;
            }
            const { paypalOrderId, captureId } = payment.metadata as PayPalPaymentMetadata;
            if (!paypalOrderId || !captureId) {
                Logger.warn(
                    `Order ${order.code} PayPal payment is missing paypalOrderId/captureId; skipping tracking`,
                    loggerCtx,
                );
                continue;
            }
            try {
                await this.payPalService.addOrderTracking(paypalOrderId, captureId, {
                    trackingNumber: fulfillment.trackingCode || undefined,
                    carrierMethod: fulfillment.method,
                    notifyPayer: true,
                });
                Logger.info(
                    `Pushed shipment tracking to PayPal for order ${order.code} ` +
                        `(capture ${captureId}, tracking "${fulfillment.trackingCode}")`,
                    loggerCtx,
                );
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                Logger.error(
                    `Failed to push tracking for order ${order.code}: ${message}`,
                    loggerCtx,
                );
            }
        }
    }

    private async getOrdersForFulfillment(
        ctx: RequestContext,
        fulfillmentId: ID,
    ): Promise<Order[]> {
        const lines = await this.connection.getRepository(ctx, FulfillmentLine).find({
            where: { fulfillment: { id: fulfillmentId } },
            relations: ['orderLine', 'orderLine.order'],
        });
        const byId = new Map<ID, Order>();
        for (const line of lines) {
            const order = line.orderLine?.order;
            if (order) {
                byId.set(order.id, order);
            }
        }
        return Array.from(byId.values());
    }

    private async findPayPalPayment(
        ctx: RequestContext,
        orderId: ID,
    ): Promise<Payment | undefined> {
        const payments = await this.orderService.getOrderPayments(ctx, orderId);
        return payments.find(
            p =>
                PAYPAL_METHOD_CODES.includes(p.method) &&
                p.state === 'Settled' &&
                !!(p.metadata as PayPalPaymentMetadata)?.captureId,
        );
    }
}
