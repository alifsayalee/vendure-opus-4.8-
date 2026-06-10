import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import { PayPalService } from '../../paypal.service';
import { PayPalBalancesReport, PayPalTransactionReport } from '../reporting-types';

/** Normalises a GraphQL DateTime arg (Date or ISO string) to an ISO-8601 string. */
function toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Resolver()
export class PayPalReportingAdminResolver {
    constructor(private readonly payPalService: PayPalService) {}

    @Query()
    @Allow(Permission.ReadPaymentMethod)
    async payPalTransactions(
        @Ctx() ctx: RequestContext,
        @Args() args: { startDate: Date | string; endDate: Date | string },
    ): Promise<PayPalTransactionReport> {
        return this.payPalService.searchTransactions(toIso(args.startDate), toIso(args.endDate));
    }

    @Query()
    @Allow(Permission.ReadPaymentMethod)
    async payPalBalances(
        @Ctx() ctx: RequestContext,
        @Args() args: { asOfTime?: Date | string; currencyCode?: string },
    ): Promise<PayPalBalancesReport> {
        return this.payPalService.getBalances(
            args.asOfTime ? toIso(args.asOfTime) : undefined,
            args.currencyCode,
        );
    }
}
