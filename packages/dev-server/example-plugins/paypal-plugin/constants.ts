/**
 * @description
 * The NestJS injection token under which the resolved {@link PayPalPluginOptions}
 * are made available to the plugin's providers.
 */
export const PAYPAL_PLUGIN_OPTIONS = Symbol('PAYPAL_PLUGIN_OPTIONS');

/**
 * @description
 * The `code` of the {@link PaymentMethod} created and used by this plugin. The
 * storefront references this value in the `addPaymentToOrder` mutation.
 */
export const PAYPAL_PAYMENT_METHOD_CODE = 'paypal';

/**
 * @description
 * Logger context label used for all log output emitted by the plugin.
 */
export const loggerCtx = 'PayPalPlugin';
