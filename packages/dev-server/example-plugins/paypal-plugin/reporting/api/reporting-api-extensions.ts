import gql from 'graphql-tag';

/**
 * Admin API extensions for PayPal transaction reporting (Use Case 7). These are
 * read-only proxies to PayPal's Transaction Search API; no data is persisted.
 */
export const reportingAdminApiExtensions = gql`
    type PayPalTransactionSummary {
        transactionId: String!
        status: String
        eventCode: String
        initiationDate: String
        updatedDate: String
        currencyCode: String
        value: String
        feeCurrencyCode: String
        feeValue: String
    }

    type PayPalTransactionReport {
        startDate: String!
        endDate: String!
        totalItems: Int!
        "When PayPal last refreshed the reporting data (subject to a ~3h delay)."
        lastRefreshedAt: String
        transactions: [PayPalTransactionSummary!]!
    }

    type PayPalBalance {
        currency: String!
        primary: Boolean!
        totalCurrencyCode: String
        totalValue: String
        availableCurrencyCode: String
        availableValue: String
        withheldCurrencyCode: String
        withheldValue: String
    }

    type PayPalBalancesReport {
        accountId: String
        asOfTime: String
        lastRefreshTime: String
        balances: [PayPalBalance!]!
    }

    extend type Query {
        """
        Lists PayPal account activity between startDate and endDate. Ranges
        longer than 31 days are automatically split into multiple PayPal queries
        and stitched together. Intended for reconciliation (data may lag by ~3h).
        """
        payPalTransactions(startDate: DateTime!, endDate: DateTime!): PayPalTransactionReport!
        "Fetches PayPal account balances, optionally as of a point in time / single currency."
        payPalBalances(asOfTime: DateTime, currencyCode: String): PayPalBalancesReport!
    }
`;
