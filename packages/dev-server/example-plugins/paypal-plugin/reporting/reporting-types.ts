/**
 * @description
 * A single transaction in a PayPal account-activity report (Use Case 7).
 * Amounts are PayPal's decimal-string values, returned as-is for display.
 */
export interface PayPalTransactionSummary {
    transactionId: string;
    status?: string;
    eventCode?: string;
    initiationDate?: string;
    updatedDate?: string;
    currencyCode?: string;
    value?: string;
    feeCurrencyCode?: string;
    feeValue?: string;
}

/** The aggregated result of a transaction search across a date range. */
export interface PayPalTransactionReport {
    startDate: string;
    endDate: string;
    totalItems: number;
    /** When PayPal last refreshed the reporting data (subject to ~3h delay). */
    lastRefreshedAt?: string;
    transactions: PayPalTransactionSummary[];
}

/** A per-currency PayPal account balance. */
export interface PayPalBalance {
    currency: string;
    primary: boolean;
    totalCurrencyCode?: string;
    totalValue?: string;
    availableCurrencyCode?: string;
    availableValue?: string;
    withheldCurrencyCode?: string;
    withheldValue?: string;
}

/** The result of a PayPal account-balances lookup. */
export interface PayPalBalancesReport {
    accountId?: string;
    asOfTime?: string;
    lastRefreshTime?: string;
    balances: PayPalBalance[];
}
