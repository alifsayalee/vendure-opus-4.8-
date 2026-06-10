import { OnApplicationBootstrap } from '@nestjs/common';
import {
    Channel,
    ChannelService,
    LanguageCode,
    Logger,
    PaymentMethod,
    PaymentMethodService,
    PluginCommonModule,
    RequestContextService,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';

import { shopApiExtensions } from './api/api-extensions';
import { PayPalShopResolver } from './api/paypal-shop.resolver';
import {
    loggerCtx,
    PAYPAL_AUTHORIZE_PAYMENT_METHOD_CODE,
    PAYPAL_PAYMENT_METHOD_CODE,
    PAYPAL_PLUGIN_OPTIONS,
} from './constants';
import { payPalPaymentHandler } from './paypal-payment-handler';
import { PayPalService } from './paypal.service';
import { PayPalIntent, PayPalPluginOptions } from './types';

/**
 * @description
 * Integrates PayPal as a payment provider for Vendure.
 *
 * This first iteration implements **Use Case 1 — Standard Checkout (Immediate
 * Capture)**:
 *
 * 1. The storefront calls the `createPayPalOrder` Shop API mutation, which
 *    creates a PayPal order with `CAPTURE` intent and returns an approval URL.
 * 2. The buyer approves the payment at PayPal.
 * 3. The storefront calls `addPaymentToOrder` with `{ method: "paypal",
 *    metadata: { paypalOrderId } }`; the payment handler captures the funds and
 *    marks the order as paid.
 *
 * ## Setup
 *
 * ```ts
 * PayPalPlugin.init({
 *     clientId: process.env.PAYPAL_CLIENT_ID as string,
 *     clientSecret: process.env.PAYPAL_CLIENT_SECRET as string,
 *     environment: 'sandbox',
 *     returnUrl: 'http://localhost:4201/checkout/paypal/return',
 *     cancelUrl: 'http://localhost:4201/checkout/paypal/cancel',
 *     brandName: 'My Store',
 * })
 * ```
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    configuration: config => {
        config.paymentOptions.paymentMethodHandlers.push(payPalPaymentHandler);
        return config;
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [PayPalShopResolver],
    },
    providers: [
        PayPalService,
        { provide: PAYPAL_PLUGIN_OPTIONS, useFactory: () => PayPalPlugin.options },
    ],
})
export class PayPalPlugin implements OnApplicationBootstrap {
    static options: PayPalPluginOptions;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly channelService: ChannelService,
        private readonly requestContextService: RequestContextService,
        private readonly paymentMethodService: PaymentMethodService,
    ) {}

    static init(options: PayPalPluginOptions): typeof PayPalPlugin {
        const missing = (['clientId', 'clientSecret', 'returnUrl', 'cancelUrl'] as const).filter(
            key => !options[key],
        );
        if (missing.length) {
            throw new Error(
                `PayPalPlugin is missing required options: ${missing.join(', ')}. ` +
                    'Provide them (e.g. from environment variables) when calling PayPalPlugin.init().',
            );
        }
        PayPalPlugin.options = options;
        return PayPalPlugin;
    }

    async onApplicationBootstrap(): Promise<void> {
        // Use Case 1 — immediate capture.
        await this.ensurePaymentMethodExists(PAYPAL_PAYMENT_METHOD_CODE, 'PayPal', 'capture');
        // Use Case 2 — authorize then capture.
        await this.ensurePaymentMethodExists(
            PAYPAL_AUTHORIZE_PAYMENT_METHOD_CODE,
            'PayPal (Authorize then Capture)',
            'authorize',
        );
    }

    /**
     * Creates a PayPal {@link PaymentMethod} on first boot if it does not yet
     * exist, and assigns it to all channels. This makes the method immediately
     * usable without any manual Admin UI configuration. Both methods share the
     * same handler, differing only by the configured `intent`.
     */
    private async ensurePaymentMethodExists(
        code: string,
        name: string,
        intent: PayPalIntent,
    ): Promise<void> {
        const existing = await this.connection.rawConnection.getRepository(PaymentMethod).findOne({
            where: { code },
        });
        if (existing) {
            return;
        }
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const allChannels = await this.connection.getRepository(ctx, Channel).find();
        const paymentMethod = await this.paymentMethodService.create(ctx, {
            code,
            enabled: true,
            handler: {
                code: payPalPaymentHandler.code,
                arguments: [{ name: 'intent', value: intent }],
            },
            translations: [{ languageCode: LanguageCode.en, name }],
        });
        await this.channelService.assignToChannels(
            ctx,
            PaymentMethod,
            paymentMethod.id,
            allChannels.map(c => c.id),
        );
        Logger.info(`Created "${code}" payment method`, loggerCtx);
    }
}
