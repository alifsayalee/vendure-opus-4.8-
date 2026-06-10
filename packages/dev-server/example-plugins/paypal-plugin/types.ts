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
 * The PayPal order intent. `capture` settles funds immediately on capture
 * (Use Case 1); `authorize` reserves funds at checkout and captures them later
 * on order fulfilment (Use Case 2).
 */
export type PayPalIntent = 'capture' | 'authorize';

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
 * The result of authorizing an approved PayPal order (Use Case 2). The
 * authorization reserves the funds without moving money.
 */
export interface AuthorizePayPalOrderResult {
    /** The PayPal-generated order id that was authorized. */
    paypalOrderId: string;
    /** The order-level status after authorization (`COMPLETED` on success). */
    orderStatus: string;
    /** The PayPal authorization id, used to later capture or void the funds. */
    authorizationId: string;
    /** The status of the authorization (`CREATED` when funds are reserved). */
    authorizationStatus: string;
    /** The authorized currency code, as reported by PayPal. */
    currencyCode?: string;
    /** The authorized amount as a decimal string, as reported by PayPal. */
    value?: string;
}

/**
 * @description
 * The result of capturing a previously authorized PayPal payment (Use Case 2).
 */
export interface CaptureAuthorizationResult {
    /** The PayPal capture id, used for later refund operations. */
    captureId: string;
    /** The status of the capture (`COMPLETED` on success). */
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
