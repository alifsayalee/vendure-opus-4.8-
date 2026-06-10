import {
    CreatePaymentResult,
    Injector,
    LanguageCode,
    Logger,
    PaymentMethodHandler,
    SettlePaymentResult,
} from '@vendure/core';

import { loggerCtx, PAYPAL_PAYMENT_METHOD_CODE } from './constants';
import { PayPalService } from './paypal.service';
import { PayPalPaymentMetadata } from './types';

let payPalService: PayPalService;

/**
 * @description
 * Handles the PayPal "standard checkout with immediate capture" flow
 * (Use Case 1).
 *
 * The buyer first approves a PayPal order created via the `createPayPalOrder`
 * Shop API mutation. The storefront then calls `addPaymentToOrder`, passing the
 * approved `paypalOrderId` in the payment metadata. `createPayment` captures the
 * funds immediately, so `settlePayment` simply confirms success.
 */
export const payPalPaymentHandler = new PaymentMethodHandler({
    code: PAYPAL_PAYMENT_METHOD_CODE,
    description: [{ languageCode: LanguageCode.en, value: 'PayPal' }],
    args: {},

    init(injector: Injector) {
        payPalService = injector.get(PayPalService);
    },

    createPayment: async (ctx, order, amount, _args, metadata): Promise<CreatePaymentResult> => {
        const { paypalOrderId } = metadata as PayPalPaymentMetadata;
        if (!paypalOrderId) {
            return {
                amount,
                state: 'Declined' as const,
                errorMessage: 'Missing paypalOrderId in payment metadata',
                metadata: {
                    public: {
                        errorMessage: 'Missing paypalOrderId in payment metadata',
                    },
                },
            };
        }

        try {
            const capture = await payPalService.captureOrder(paypalOrderId);

            if (capture.captureStatus !== 'COMPLETED') {
                Logger.warn(
                    `PayPal capture for order ${order.code} was not completed (status: ${capture.captureStatus})`,
                    loggerCtx,
                );
                return {
                    amount,
                    state: 'Declined' as const,
                    transactionId: capture.captureId,
                    errorMessage: `PayPal capture status: ${capture.captureStatus}`,
                    metadata: {
                        paypalOrderId: capture.paypalOrderId,
                        captureId: capture.captureId,
                        captureStatus: capture.captureStatus,
                    },
                };
            }

            Logger.info(
                `Captured PayPal payment for order ${order.code} (capture ${capture.captureId})`,
                loggerCtx,
            );
            return {
                amount,
                state: 'Settled' as const,
                transactionId: capture.captureId,
                metadata: {
                    paypalOrderId: capture.paypalOrderId,
                    captureId: capture.captureId,
                    captureStatus: capture.captureStatus,
                    currencyCode: capture.currencyCode,
                    value: capture.value,
                },
            };
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            return {
                amount,
                state: 'Declined' as const,
                errorMessage,
                metadata: {
                    public: { errorMessage },
                },
            };
        }
    },

    settlePayment: async (): Promise<SettlePaymentResult> => {
        // The payment is captured immediately in `createPayment`, so there is
        // nothing further to do here for the immediate-capture flow.
        return { success: true };
    },
});
