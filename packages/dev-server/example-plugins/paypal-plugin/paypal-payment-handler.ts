import {
    CancelPaymentErrorResult,
    CancelPaymentResult,
    CreatePaymentResult,
    CreateRefundResult,
    Injector,
    LanguageCode,
    Logger,
    PaymentMethodHandler,
    RefundState,
    SettlePaymentErrorResult,
    SettlePaymentResult,
} from '@vendure/core';

import { loggerCtx, PAYPAL_PAYMENT_METHOD_CODE } from './constants';
import { PayPalService } from './paypal.service';
import { PayPalIntent, PayPalPaymentMetadata } from './types';

let payPalService: PayPalService;

function resolveIntent(value: string | undefined): PayPalIntent {
    return value === 'authorize' ? 'authorize' : 'capture';
}

/**
 * @description
 * Handles the PayPal checkout flows driven by the `addPaymentToOrder` mutation.
 *
 * The behaviour is selected by the `intent` argument configured on the
 * {@link PaymentMethod}:
 *
 * - **`capture`** (Use Case 1 — immediate capture): `createPayment` captures the
 *   approved PayPal order straight away and the payment becomes `Settled`.
 *   `settlePayment` is therefore a no-op.
 * - **`authorize`** (Use Case 2 — authorize then capture): `createPayment`
 *   authorizes the approved PayPal order, reserving the funds, and the payment
 *   becomes `Authorized`. `settlePayment` later captures the authorized funds
 *   (e.g. when the order is fulfilled).
 *
 * In both flows the buyer first approves a PayPal order created via the
 * `createPayPalOrder` Shop API mutation, and the storefront passes the approved
 * `paypalOrderId` in the payment metadata.
 */
export const payPalPaymentHandler = new PaymentMethodHandler({
    code: PAYPAL_PAYMENT_METHOD_CODE,
    description: [{ languageCode: LanguageCode.en, value: 'PayPal' }],
    args: {
        intent: {
            type: 'string',
            defaultValue: 'capture',
            label: [{ languageCode: LanguageCode.en, value: 'Intent' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: '"capture" captures immediately; "authorize" reserves funds and captures on settlement',
                },
            ],
            ui: {
                component: 'select-form-input',
                options: [
                    { value: 'capture', label: [{ languageCode: LanguageCode.en, value: 'Capture' }] },
                    {
                        value: 'authorize',
                        label: [{ languageCode: LanguageCode.en, value: 'Authorize' }],
                    },
                ],
            },
        },
    },

    init(injector: Injector) {
        payPalService = injector.get(PayPalService);
    },

    createPayment: async (ctx, order, amount, args, metadata): Promise<CreatePaymentResult> => {
        const { paypalOrderId } = metadata as PayPalPaymentMetadata;
        if (!paypalOrderId) {
            return declined(amount, 'Missing paypalOrderId in payment metadata');
        }
        const intent = resolveIntent(args.intent);

        try {
            if (intent === 'authorize') {
                return await authorize(order.code, amount, paypalOrderId);
            }
            return await capture(order.code, amount, paypalOrderId);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            return declined(amount, errorMessage);
        }
    },

    settlePayment: async (
        ctx,
        order,
        payment,
        args,
    ): Promise<SettlePaymentResult | SettlePaymentErrorResult> => {
        const intent = resolveIntent(args.intent);

        // Immediate-capture payments are already settled in `createPayment`.
        if (intent !== 'authorize') {
            return { success: true };
        }

        const md = payment.metadata as { authorizationId?: string; paypalOrderId?: string };
        const authorizationId = md?.authorizationId;
        if (!authorizationId) {
            return {
                success: false,
                errorMessage: 'Cannot settle PayPal payment: missing authorizationId in metadata',
            };
        }

        try {
            const capture = await payPalService.captureAuthorization(authorizationId, md.paypalOrderId);
            if (capture.captureStatus !== 'COMPLETED') {
                return {
                    success: false,
                    errorMessage: `PayPal capture status: ${capture.captureStatus}`,
                    metadata: { captureId: capture.captureId, captureStatus: capture.captureStatus },
                };
            }
            Logger.info(
                `Captured authorized PayPal payment for order ${order.code} (capture ${capture.captureId})`,
                loggerCtx,
            );
            return {
                success: true,
                metadata: {
                    captureId: capture.captureId,
                    captureStatus: capture.captureStatus,
                    currencyCode: capture.currencyCode,
                    value: capture.value,
                },
            };
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            return { success: false, errorMessage };
        }
    },

    cancelPayment: async (
        ctx,
        order,
        payment,
        args,
    ): Promise<CancelPaymentResult | CancelPaymentErrorResult> => {
        const authorizationId = (payment.metadata as { authorizationId?: string })?.authorizationId;

        // Only the authorize flow holds reservable funds at PayPal. For an
        // immediate-capture payment there is no authorization to void (a captured
        // payment must be refunded, not voided), so there is nothing to do here.
        if (!authorizationId) {
            return { success: true };
        }

        try {
            const result = await payPalService.voidAuthorization(authorizationId);
            Logger.info(
                `Voided PayPal authorization ${authorizationId} for order ${order.code} (status ${result.status})`,
                loggerCtx,
            );
            return {
                success: true,
                metadata: { voided: true, authorizationId, voidStatus: result.status },
            };
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            Logger.warn(
                `Failed to void PayPal authorization ${authorizationId} for order ${order.code}: ${errorMessage}`,
                loggerCtx,
            );
            return { success: false, errorMessage };
        }
    },

    createRefund: async (ctx, input, amount, order, payment): Promise<CreateRefundResult> => {
        const captureId = (payment.metadata as { captureId?: string })?.captureId;
        if (!captureId) {
            Logger.warn(
                `Cannot refund payment ${payment.id} for order ${order.code}: missing captureId`,
                loggerCtx,
            );
            return { state: 'Failed' as const, metadata: { errorMessage: 'Missing captureId in payment metadata' } };
        }

        // Use Case 4 handles FULL refunds only (the entire captured amount).
        // Partial refunds (a smaller amount) are implemented in Use Case 5.
        if (amount < payment.amount) {
            Logger.warn(
                `Partial refund of ${amount} requested for payment ${payment.id} (amount ${payment.amount}); ` +
                    'partial refunds are not yet supported',
                loggerCtx,
            );
            return {
                state: 'Failed' as const,
                metadata: { errorMessage: 'Partial refunds are not yet supported' },
            };
        }

        try {
            const refund = await payPalService.refundCapture(captureId);
            Logger.info(
                `Refunded PayPal capture ${captureId} for order ${order.code} (refund ${refund.refundId}, status ${refund.status})`,
                loggerCtx,
            );
            return {
                state: mapRefundState(refund.status),
                transactionId: refund.refundId,
                metadata: {
                    refundId: refund.refundId,
                    refundStatus: refund.status,
                    currencyCode: refund.currencyCode,
                    value: refund.value,
                },
            };
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            return { state: 'Failed' as const, metadata: { errorMessage } };
        }
    },
});

/** Maps a PayPal refund status to the corresponding Vendure {@link RefundState}. */
function mapRefundState(status: string): RefundState {
    if (status === 'COMPLETED') {
        return 'Settled';
    }
    if (status === 'PENDING') {
        return 'Pending';
    }
    return 'Failed';
}

async function capture(
    orderCode: string,
    amount: number,
    paypalOrderId: string,
): Promise<CreatePaymentResult> {
    const result = await payPalService.captureOrder(paypalOrderId);
    if (result.captureStatus !== 'COMPLETED') {
        Logger.warn(
            `PayPal capture for order ${orderCode} was not completed (status: ${result.captureStatus})`,
            loggerCtx,
        );
        return {
            amount,
            state: 'Declined' as const,
            transactionId: result.captureId,
            errorMessage: `PayPal capture status: ${result.captureStatus}`,
            metadata: {
                paypalOrderId: result.paypalOrderId,
                captureId: result.captureId,
                captureStatus: result.captureStatus,
            },
        };
    }
    Logger.info(
        `Captured PayPal payment for order ${orderCode} (capture ${result.captureId})`,
        loggerCtx,
    );
    return {
        amount,
        state: 'Settled' as const,
        transactionId: result.captureId,
        metadata: {
            paypalOrderId: result.paypalOrderId,
            captureId: result.captureId,
            captureStatus: result.captureStatus,
            currencyCode: result.currencyCode,
            value: result.value,
        },
    };
}

async function authorize(
    orderCode: string,
    amount: number,
    paypalOrderId: string,
): Promise<CreatePaymentResult> {
    const result = await payPalService.authorizeOrder(paypalOrderId);
    if (result.authorizationStatus !== 'CREATED') {
        Logger.warn(
            `PayPal authorization for order ${orderCode} was not created (status: ${result.authorizationStatus})`,
            loggerCtx,
        );
        return {
            amount,
            state: 'Declined' as const,
            transactionId: result.authorizationId,
            errorMessage: `PayPal authorization status: ${result.authorizationStatus}`,
            metadata: {
                paypalOrderId: result.paypalOrderId,
                authorizationId: result.authorizationId,
                authorizationStatus: result.authorizationStatus,
            },
        };
    }
    Logger.info(
        `Authorized PayPal payment for order ${orderCode} (authorization ${result.authorizationId})`,
        loggerCtx,
    );
    return {
        amount,
        state: 'Authorized' as const,
        transactionId: result.authorizationId,
        metadata: {
            paypalOrderId: result.paypalOrderId,
            authorizationId: result.authorizationId,
            authorizationStatus: result.authorizationStatus,
            currencyCode: result.currencyCode,
            value: result.value,
        },
    };
}

function declined(amount: number, errorMessage: string): CreatePaymentResult {
    return {
        amount,
        state: 'Declined' as const,
        errorMessage,
        metadata: { public: { errorMessage } },
    };
}
