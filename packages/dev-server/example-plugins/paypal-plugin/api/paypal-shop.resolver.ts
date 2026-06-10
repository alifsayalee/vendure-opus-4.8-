import { Mutation, Resolver } from '@nestjs/graphql';
import {
    ActiveOrderService,
    Allow,
    Ctx,
    Permission,
    RequestContext,
    UserInputError,
} from '@vendure/core';

import { PayPalService } from '../paypal.service';
import { CreatePayPalOrderResult } from '../types';

@Resolver()
export class PayPalShopResolver {
    constructor(
        private readonly payPalService: PayPalService,
        private readonly activeOrderService: ActiveOrderService,
    ) {}

    /**
     * @description
     * Creates a PayPal order (CAPTURE intent) for the customer's active order
     * and returns the approval URL to which the storefront must redirect the
     * buyer.
     */
    @Mutation()
    @Allow(Permission.Public)
    async createPayPalOrder(@Ctx() ctx: RequestContext): Promise<CreatePayPalOrderResult> {
        const order = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (!order) {
            throw new UserInputError('No active order found for the current session');
        }
        if (order.totalWithTax <= 0) {
            throw new UserInputError('Cannot create a PayPal order for a zero-value order');
        }
        return this.payPalService.createOrder(order.totalWithTax, order.currencyCode, order.code);
    }
}
