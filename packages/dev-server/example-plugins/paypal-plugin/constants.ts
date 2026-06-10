/**
 * @description
 * The NestJS injection token under which the resolved {@link PayPalPluginOptions}
 * are made available to the plugin's providers.
 */
export const PAYPAL_PLUGIN_OPTIONS = Symbol('PAYPAL_PLUGIN_OPTIONS');

/**
 * @description
 * The `code` of the immediate-capture {@link PaymentMethod} (Use Case 1). The
 * storefront references this value in the `addPaymentToOrder` mutation.
 */
export const PAYPAL_PAYMENT_METHOD_CODE = 'paypal';

/**
 * @description
 * The `code` of the authorize-then-capture {@link PaymentMethod} (Use Case 2).
 * Uses the same handler as {@link PAYPAL_PAYMENT_METHOD_CODE} but configured
 * with the `authorize` intent.
 */
export const PAYPAL_AUTHORIZE_PAYMENT_METHOD_CODE = 'paypal-authorize';

/**
 * @description
 * Logger context label used for all log output emitted by the plugin.
 */
export const loggerCtx = 'PayPalPlugin';
