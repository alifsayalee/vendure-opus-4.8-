import gql from 'graphql-tag';

/**
 * Shared type/enum definitions used by both the Admin and Shop subscription
 * APIs. Each API extends `Query`/`Mutation` with its own operations.
 */
const commonTypes = gql`
    enum PayPalIntervalUnit {
        DAY
        WEEK
        MONTH
        YEAR
    }

    type PayPalSubscription implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        paypalSubscriptionId: String!
        planId: String!
        status: String!
        customerId: ID
        approvalUrl: String
        lastSyncedAt: DateTime
    }

    type PayPalSubscriptionList {
        items: [PayPalSubscription!]!
        totalItems: Int!
    }
`;

export const subscriptionAdminApiExtensions = gql`
    ${commonTypes}

    type PayPalBillingPlanResult {
        planId: String!
        status: String!
    }

    input CreatePayPalBillingPlanInput {
        "The id of a PayPal Catalog Product created beforehand in the PayPal dashboard."
        productId: String!
        name: String!
        description: String
        "The recurring price in minor units (e.g. 1000 = $10.00)."
        amount: Money!
        currencyCode: String!
        intervalUnit: PayPalIntervalUnit!
        intervalCount: Int!
        "Number of charges; 0 (default) bills indefinitely."
        totalCycles: Int
        paymentFailureThreshold: Int
        activateImmediately: Boolean
    }

    extend type Query {
        payPalSubscriptions(skip: Int, take: Int, status: String): PayPalSubscriptionList!
        payPalSubscription(id: ID!): PayPalSubscription
    }

    extend type Mutation {
        createPayPalBillingPlan(input: CreatePayPalBillingPlanInput!): PayPalBillingPlanResult!
        activatePayPalBillingPlan(planId: String!): Boolean!
        deactivatePayPalBillingPlan(planId: String!): Boolean!
        updatePayPalBillingPlanPricing(planId: String!, amount: Money!, currencyCode: String!): Boolean!
        updatePayPalBillingPlanFailureThreshold(planId: String!, threshold: Int!): Boolean!
        createPayPalSubscription(planId: String!): PayPalSubscription!
        syncPayPalSubscription(id: ID!): PayPalSubscription!
        cancelPayPalSubscription(id: ID!, reason: String!): PayPalSubscription!
        suspendPayPalSubscription(id: ID!, reason: String!): PayPalSubscription!
        activatePayPalSubscription(id: ID!, reason: String!): PayPalSubscription!
        retryPayPalSubscriptionPayment(
            id: ID!
            amount: Money!
            currencyCode: String!
            note: String!
        ): PayPalSubscription!
    }
`;

export const subscriptionShopApiExtensions = gql`
    ${commonTypes}

    extend type Query {
        "Lists the active customer's PayPal subscriptions."
        myPayPalSubscriptions: [PayPalSubscription!]!
    }

    extend type Mutation {
        "Creates a subscription for the given plan and returns the buyer approval URL."
        createPayPalSubscription(planId: String!): PayPalSubscription!
        "Cancels one of the active customer's own subscriptions."
        cancelPayPalSubscription(id: ID!, reason: String!): PayPalSubscription!
    }
`;
