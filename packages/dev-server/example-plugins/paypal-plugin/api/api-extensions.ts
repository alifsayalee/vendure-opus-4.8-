import gql from 'graphql-tag';

/**
 * @description
 * Shop API extensions for the PayPal plugin. `createPayPalOrder` creates a
 * PayPal order for the active Vendure order and returns the buyer approval URL
 * which the storefront uses to redirect the customer to PayPal.
 */
export const shopApiExtensions = gql`
    """
    The PayPal order intent: CAPTURE settles funds immediately (Use Case 1);
    AUTHORIZE reserves funds for later capture on fulfilment (Use Case 2).
    """
    enum PayPalOrderIntent {
        CAPTURE
        AUTHORIZE
    }

    type CreatePayPalOrderResult {
        paypalOrderId: String!
        status: String!
        approvalUrl: String!
    }

    extend type Mutation {
        createPayPalOrder(intent: PayPalOrderIntent = CAPTURE): CreatePayPalOrderResult!
    }
`;
