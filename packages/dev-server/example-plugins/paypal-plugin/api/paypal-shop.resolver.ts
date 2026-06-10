import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
    ActiveOrderService,
    Allow,
    Ctx,
    Permission,
    RequestContext,
    UserInputError,
} from '@vendure/core';

import { PayPalService } from '../paypal.service';
import { CreatePayPalOrderResult, PayPalIntent } from '../types';

@Resolver()
export class PayPalShopResolver {
    constructor(
        private readonly payPalService: PayPalService,
        private readonly activeOrderService: ActiveOrderService,
    ) {}

    /**
     * @description
     * Creates a PayPal order for the customer's active order and returns the
     * approval URL to which the storefront must redirect the buyer. The
     * `intent` argument selects immediate capture (Use Case 1) or
     * authorize-then-capture (Use Case 2).
     */
    @Mutation()
    @Allow(Permission.Public)
    async createPayPalOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: { intent?: 'CAPTURE' | 'AUTHORIZE' },
    ): Promise<CreatePayPalOrderResult> {
        const order = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (!order) {
            throw new UserInputError('No active order found for the current session');
        }
        if (order.totalWithTax <= 0) {
            throw new UserInputError('Cannot create a PayPal order for a zero-value order');
        }
        const intent: PayPalIntent = args.intent === 'AUTHORIZE' ? 'authorize' : 'capture';
        return this.payPalService.createOrder(
            order.totalWithTax,
            order.currencyCode,
            order.code,
            intent,
        );
    }
}
