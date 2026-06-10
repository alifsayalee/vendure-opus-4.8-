/**
 * @description
 * Configuration options for the {@link PayPalPlugin}. Credentials are never
 * hard-coded; supply them from environment variables when calling
 * `PayPalPlugin.init()`.
 */
export interface PayPalPluginOptions {
    /**
     * @description
     * The PayPal REST API client ID (from `PAYPAL_CLIENT_ID`).
     */
    clientId: string;
    /**
     * @description
     * The PayPal REST API client secret (from `PAYPAL_CLIENT_SECRET`).
     */
    clientSecret: string;
    /**
     * @description
     * Which PayPal environment to target. Defaults to `'sandbox'`.
     */
    environment?: 'sandbox' | 'production';
    /**
     * @description
     * The URL on the storefront to which PayPal redirects the buyer after a
     * successful approval. The approved PayPal order id is appended by PayPal
     * as a `token` query parameter.
     */
    returnUrl: string;
    /**
     * @description
     * The URL on the storefront to which PayPal redirects the buyer if they
     * cancel the approval flow.
     */
    cancelUrl: string;
    /**
     * @description
     * Optional brand name shown to the buyer on the PayPal approval pages.
     */
    brandName?: string;
}

/**
 * @description
 * The result of creating a PayPal order, returned to the storefront so it can
 * redirect the buyer to PayPal for approval.
 */
export interface CreatePayPalOrderResult {
    /** The PayPal-generated order id. */
    paypalOrderId: string;
    /** The current PayPal order status (e.g. `CREATED`). */
    status: string;
    /** The URL to which the buyer must be redirected to approve the payment. */
    approvalUrl: string;
}

/**
 * @description
 * The result of capturing an approved PayPal order.
 */
export interface CapturePayPalOrderResult {
    /** The PayPal-generated order id that was captured. */
    paypalOrderId: string;
    /** The order-level status after capture (`COMPLETED` on success). */
    orderStatus: string;
    /** The PayPal capture id, used for later refund operations. */
    captureId: string;
    /** The status of the individual capture (`COMPLETED` on success). */
    captureStatus: string;
    /** The captured currency code, as reported by PayPal. */
    currencyCode?: string;
    /** The captured amount as a decimal string, as reported by PayPal. */
    value?: string;
}

/**
 * @description
 * The shape of the `metadata` passed by the storefront to the
 * `addPaymentToOrder` mutation when paying with PayPal.
 */
export interface PayPalPaymentMetadata {
    /** The PayPal order id obtained from the `createPayPalOrder` mutation. */
    paypalOrderId?: string;
}
