import gql from 'graphql-tag';

/**
 * @description
 * Shop API extensions for the PayPal plugin. `createPayPalOrder` creates a
 * PayPal order for the active Vendure order and returns the buyer approval URL
 * which the storefront uses to redirect the customer to PayPal.
 */
export const shopApiExtensions = gql`
    type CreatePayPalOrderResult {
        paypalOrderId: String!
        status: String!
        approvalUrl: String!
    }

    extend type Mutation {
        createPayPalOrder: CreatePayPalOrderResult!
    }
`;
