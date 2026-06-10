import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    ForbiddenError,
    ID,
    idsAreEqual,
    Permission,
    RequestContext,
    UserInputError,
} from '@vendure/core';

import { PayPalSubscription } from '../paypal-subscription.entity';
import { PayPalSubscriptionService } from '../paypal-subscription.service';

@Resolver()
export class PayPalSubscriptionShopResolver {
    constructor(private readonly subscriptionService: PayPalSubscriptionService) {}

    @Query()
    @Allow(Permission.Authenticated)
    async myPayPalSubscriptions(@Ctx() ctx: RequestContext): Promise<PayPalSubscription[]> {
        const customerId = await this.subscriptionService.getActiveCustomerId(ctx);
        if (!customerId) {
            return [];
        }
        return this.subscriptionService.findByCustomer(ctx, customerId);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async createPayPalSubscription(
        @Ctx() ctx: RequestContext,
        @Args() args: { planId: string },
    ): Promise<PayPalSubscription> {
        const { subscription } = await this.subscriptionService.createSubscription(ctx, args.planId);
        return subscription;
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async cancelPayPalSubscription(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID; reason: string },
    ): Promise<PayPalSubscription> {
        const subscription = await this.subscriptionService.findOne(ctx, args.id);
        if (!subscription) {
            throw new UserInputError(`No PayPal subscription found with id "${args.id}"`);
        }
        // A customer may only cancel their own subscription.
        const customerId = await this.subscriptionService.getActiveCustomerId(ctx);
        if (!customerId || subscription.customerId == null || !idsAreEqual(subscription.customerId, customerId)) {
            throw new ForbiddenError();
        }
        return this.subscriptionService.cancel(ctx, subscription, args.reason);
    }
}
