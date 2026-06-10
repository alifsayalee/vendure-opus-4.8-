import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@vendure/core';
import {
    ApiError,
    CapturedPayment,
    CheckoutPaymentIntent,
    Client,
    CustomError,
    Environment,
    LogLevel,
    Order as PayPalOrder,
    OrderAuthorizeResponse,
    OrdersController,
    PaymentsController,
    Refund,
} from '@paypal/paypal-server-sdk';

import { loggerCtx, PAYPAL_PLUGIN_OPTIONS } from './constants';
import {
    AuthorizePayPalOrderResult,
    CaptureAuthorizationResult,
    CapturePayPalOrderResult,
    CreatePayPalOrderResult,
    PayPalIntent,
    PayPalPluginOptions,
    RefundCaptureResult,
    VoidAuthorizationResult,
} from './types';

/**
 * @description
 * Wraps the PayPal Server SDK and exposes the order operations required by the
 * plugin. The SDK client is constructed once and reused; OAuth2 access tokens
 * are managed and refreshed internally by the SDK.
 *
 * All credentials are sourced from the injected {@link PayPalPluginOptions} and
 * are never logged.
 */
@Injectable()
export class PayPalService {
    private readonly ordersController: OrdersController;
    private readonly paymentsController: PaymentsController;

    constructor(@Inject(PAYPAL_PLUGIN_OPTIONS) private readonly options: PayPalPluginOptions) {
        const client = new Client({
            clientCredentialsAuthCredentials: {
                oAuthClientId: options.clientId,
                oAuthClientSecret: options.clientSecret,
            },
            timeout: 0,
            environment:
                options.environment === 'production' ? Environment.Production : Environment.Sandbox,
            logging: {
                logLevel: LogLevel.Info,
                // Never log request/response bodies, which can contain sensitive data.
                logRequest: { logBody: false },
                logResponse: { logHeaders: false },
            },
        });
        this.ordersController = new OrdersController(client);
        this.paymentsController = new PaymentsController(client);
    }

    /**
     * @description
     * Creates a PayPal order for the given amount and returns the order id and
     * the buyer approval URL.
     *
     * @param amountMinorUnits The amount in integer minor units (e.g. `1000` = $10.00).
     * @param currencyCode The three-character ISO-4217 currency code.
     * @param referenceId An opaque reference (the Vendure order code) attached to
     * the PayPal order for reconciliation.
     * @param intent `capture` for immediate capture (Use Case 1) or `authorize`
     * to reserve funds for later capture (Use Case 2). Defaults to `capture`.
     */
    async createOrder(
        amountMinorUnits: number,
        currencyCode: string,
        referenceId: string,
        intent: PayPalIntent = 'capture',
    ): Promise<CreatePayPalOrderResult> {
        let result: PayPalOrder;
        try {
            result = await this.withRetry(
                'create the PayPal order',
                async () =>
                    (
                        await this.ordersController.createOrder({
                            body: {
                                intent:
                                    intent === 'authorize'
                                        ? CheckoutPaymentIntent.Authorize
                                        : CheckoutPaymentIntent.Capture,
                                purchaseUnits: [
                                    {
                                        referenceId,
                                        amount: {
                                            currencyCode,
                                            value: this.toPayPalValue(amountMinorUnits, currencyCode),
                                        },
                                    },
                                ],
                                paymentSource: {
                                    paypal: {
                                        experienceContext: {
                                            returnUrl: this.options.returnUrl,
                                            cancelUrl: this.options.cancelUrl,
                                            ...(this.options.brandName
                                                ? { brandName: this.options.brandName }
                                                : {}),
                                        },
                                    },
                                },
                            },
                            prefer: 'return=representation',
                        })
                    ).result,
            );
        } catch (e) {
            throw this.toError('create the PayPal order', e);
        }

        if (!result?.id) {
            throw new Error('PayPal did not return an order id when creating the order');
        }

        const approvalUrl = this.extractApprovalUrl(result);
        if (!approvalUrl) {
            throw new Error('PayPal did not return a buyer approval URL for the created order');
        }

        return {
            paypalOrderId: result.id,
            status: result.status ?? 'CREATED',
            approvalUrl,
        };
    }

    /**
     * @description
     * Captures payment for a PayPal order that the buyer has already approved.
     * Returns the capture id and status used to settle the Vendure payment and
     * to support later refunds.
     *
     * @param paypalOrderId The PayPal order id returned by {@link createOrder}.
     */
    async captureOrder(paypalOrderId: string): Promise<CapturePayPalOrderResult> {
        let result: PayPalOrder;
        try {
            result = await this.withRetry(
                'capture the PayPal order',
                async () =>
                    (
                        await this.ordersController.captureOrder({
                            id: paypalOrderId,
                            prefer: 'return=representation',
                            // Idempotency key: a retried capture returns the original
                            // capture instead of charging the buyer twice.
                            paypalRequestId: `capture-order-${paypalOrderId}`,
                        })
                    ).result,
            );
        } catch (e) {
            throw this.toError('capture the PayPal order', e);
        }

        const capture = result?.purchaseUnits?.[0]?.payments?.captures?.[0];
        if (!result?.id || !capture?.id || !capture.status) {
            throw new Error('PayPal capture response did not contain a completed capture');
        }

        return {
            paypalOrderId: result.id,
            orderStatus: result.status ?? 'UNKNOWN',
            captureId: capture.id,
            captureStatus: capture.status,
            currencyCode: capture.amount?.currencyCode,
            value: capture.amount?.value,
        };
    }

    /**
     * @description
     * Authorizes payment for a PayPal order that the buyer has already approved,
     * reserving the funds without capturing them (Use Case 2). Returns the
     * authorization id used to later capture or void the funds.
     *
     * @param paypalOrderId The PayPal order id returned by {@link createOrder}.
     */
    async authorizeOrder(paypalOrderId: string): Promise<AuthorizePayPalOrderResult> {
        let result: OrderAuthorizeResponse;
        try {
            result = await this.withRetry(
                'authorize the PayPal order',
                async () =>
                    (
                        await this.ordersController.authorizeOrder({
                            id: paypalOrderId,
                            prefer: 'return=representation',
                            // Idempotency key: a retried authorize returns the original
                            // authorization instead of reserving the funds twice.
                            paypalRequestId: `authorize-${paypalOrderId}`,
                        })
                    ).result,
            );
        } catch (e) {
            throw this.toError('authorize the PayPal order', e);
        }

        const authorization = result?.purchaseUnits?.[0]?.payments?.authorizations?.[0];
        if (!result?.id || !authorization?.id || !authorization.status) {
            throw new Error('PayPal authorize response did not contain an authorization');
        }

        return {
            paypalOrderId: result.id,
            orderStatus: result.status ?? 'UNKNOWN',
            authorizationId: authorization.id,
            authorizationStatus: authorization.status,
            currencyCode: authorization.amount?.currencyCode,
            value: authorization.amount?.value,
        };
    }

    /**
     * @description
     * Captures funds that were previously reserved by {@link authorizeOrder}
     * (Use Case 2). Returns the capture id and status used to settle the Vendure
     * payment and support later refunds.
     *
     * @param authorizationId The PayPal authorization id from {@link authorizeOrder}.
     * @param paypalOrderId The originating PayPal order id, used to recover the
     * capture details if a previous attempt already captured the funds.
     */
    async captureAuthorization(
        authorizationId: string,
        paypalOrderId?: string,
    ): Promise<CaptureAuthorizationResult> {
        try {
            return await this.withRetry(
                'capture the authorized PayPal payment',
                async attempt => {
                    // `captureAuthorizedPayment` does not accept an idempotency key,
                    // so before retrying we check whether a previous (possibly
                    // timed-out) attempt already captured the funds. This prevents
                    // double-charging the buyer.
                    if (attempt > 1) {
                        const existing = await this.findExistingCapture(
                            authorizationId,
                            paypalOrderId,
                        );
                        if (existing) {
                            return existing;
                        }
                    }

                    let capture: CapturedPayment;
                    try {
                        const response = await this.paymentsController.captureAuthorizedPayment({
                            authorizationId,
                            prefer: 'return=representation',
                            body: { finalCapture: true },
                        });
                        capture = response.result;
                    } catch (e) {
                        // If the authorization was already captured by an earlier
                        // attempt, recover that capture instead of failing.
                        if (this.isAlreadyCaptured(e)) {
                            const existing = await this.findExistingCapture(
                                authorizationId,
                                paypalOrderId,
                            );
                            if (existing) {
                                return existing;
                            }
                        }
                        throw e;
                    }

                    if (!capture?.id || !capture.status) {
                        throw new Error(
                            'PayPal capture-authorization response did not contain a capture',
                        );
                    }

                    return {
                        captureId: capture.id,
                        captureStatus: capture.status,
                        currencyCode: capture.amount?.currencyCode,
                        value: capture.amount?.value,
                    };
                },
            );
        } catch (e) {
            throw this.toError('capture the authorized PayPal payment', e);
        }
    }

    /**
     * @description
     * Voids (cancels) an authorized but uncaptured PayPal payment, releasing the
     * reserved funds back to the buyer (Use Case 3). Cannot void an authorization
     * that has already been fully captured.
     *
     * @param authorizationId The PayPal authorization id from {@link authorizeOrder}.
     */
    async voidAuthorization(authorizationId: string): Promise<VoidAuthorizationResult> {
        let result: Awaited<ReturnType<PaymentsController['voidPayment']>>['result'];
        try {
            result = await this.withRetry(
                'void the authorized PayPal payment',
                async () =>
                    (
                        await this.paymentsController.voidPayment({
                            authorizationId,
                            prefer: 'return=representation',
                            // Idempotency key: a retried void is a no-op rather than an error.
                            paypalRequestId: `void-${authorizationId}`,
                        })
                    ).result,
            );
        } catch (e) {
            throw this.toError('void the authorized PayPal payment', e);
        }

        // With `return=representation` the result is the voided authorization;
        // with `return=minimal` (or a 204) it may be null, which still indicates
        // a successful void.
        return {
            authorizationId,
            status: result?.status ?? 'VOIDED',
        };
    }

    /**
     * @description
     * Refunds a captured PayPal payment (Use Cases 4 & 5). When `amountMinorUnits`
     * is omitted the entire captured amount is refunded (full refund); when
     * provided, that specific amount is refunded (partial refund).
     *
     * @param captureId The PayPal capture id stored on the settled payment.
     * @param options Optional partial-refund amount and its currency code.
     */
    async refundCapture(
        captureId: string,
        options?: { amountMinorUnits: number; currencyCode: string },
    ): Promise<RefundCaptureResult> {
        let result: Refund;
        try {
            result = await this.withRetry('refund the captured PayPal payment', async () => {
                const body =
                    options !== undefined
                        ? {
                              amount: {
                                  currencyCode: options.currencyCode,
                                  value: this.toPayPalValue(
                                      options.amountMinorUnits,
                                      options.currencyCode,
                                  ),
                              },
                          }
                        : undefined;
                return (
                    await this.paymentsController.refundCapturedPayment({
                        captureId,
                        prefer: 'return=representation',
                        // Idempotency key: a retried refund returns the original
                        // refund instead of refunding the buyer twice. The key is
                        // specific to the amount so distinct partial refunds are
                        // treated as separate operations.
                        paypalRequestId: options
                            ? `refund-${captureId}-${options.amountMinorUnits}`
                            : `refund-${captureId}-full`,
                        body,
                    })
                ).result;
            });
        } catch (e) {
            throw this.toError('refund the captured PayPal payment', e);
        }

        if (!result?.id || !result.status) {
            throw new Error('PayPal refund response did not contain a refund');
        }

        return {
            refundId: result.id,
            status: result.status,
            currencyCode: result.amount?.currencyCode,
            value: result.amount?.value,
        };
    }

    /**
     * Best-effort lookup of an already-captured payment for an authorization.
     * Used as an idempotency safeguard when retrying captures, since the
     * capture-authorization endpoint has no idempotency key. Returns `undefined`
     * if the authorization has not been captured or the lookup is inconclusive.
     */
    private async findExistingCapture(
        authorizationId: string,
        paypalOrderId?: string,
    ): Promise<CaptureAuthorizationResult | undefined> {
        let status: string | undefined;
        try {
            const response = await this.paymentsController.getAuthorizedPayment({ authorizationId });
            status = response.result?.status;
        } catch {
            // If we cannot determine the status, let the caller proceed/fail normally.
            return undefined;
        }
        if (status !== 'CAPTURED' && status !== 'PARTIALLY_CAPTURED') {
            return undefined;
        }

        // The funds are already captured. Recover the real capture id from the
        // PayPal order so refunds (Use Cases 4 & 5) can reference it.
        if (paypalOrderId) {
            try {
                const order = await this.ordersController.getOrder({ id: paypalOrderId });
                const capture = order.result?.purchaseUnits?.[0]?.payments?.captures?.[0];
                if (capture?.id && capture.status) {
                    Logger.warn(
                        `Recovered existing capture ${capture.id} for authorization ${authorizationId}`,
                        loggerCtx,
                    );
                    return {
                        captureId: capture.id,
                        captureStatus: capture.status,
                        currencyCode: capture.amount?.currencyCode,
                        value: capture.amount?.value,
                    };
                }
            } catch {
                // Fall through to the warning below.
            }
        }

        Logger.warn(
            `Authorization ${authorizationId} is already captured but the capture id could not ` +
                'be recovered; manual reconciliation may be required',
            loggerCtx,
        );
        return { captureId: authorizationId, captureStatus: 'COMPLETED' };
    }

    /**
     * Converts an integer amount in minor units into the decimal string format
     * expected by PayPal, honouring the number of fraction digits defined for
     * the currency (e.g. 2 for USD, 0 for JPY).
     */
    private toPayPalValue(amountMinorUnits: number, currencyCode: string): string {
        const fractionDigits = this.getCurrencyFractionDigits(currencyCode);
        const divisor = Math.pow(10, fractionDigits);
        return (amountMinorUnits / divisor).toFixed(fractionDigits);
    }

    private getCurrencyFractionDigits(currencyCode: string): number {
        try {
            const format = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currencyCode,
            });
            return format.resolvedOptions().maximumFractionDigits ?? 2;
        } catch {
            return 2;
        }
    }

    private extractApprovalUrl(order: PayPalOrder): string | undefined {
        const link = order.links?.find(l => l.rel === 'approve' || l.rel === 'payer-action');
        return link?.href;
    }

    /**
     * Runs the given operation, retrying with exponential backoff when it fails
     * with a transient error (network timeout/reset, HTTP 429 or 5xx). The
     * callback receives the 1-based attempt number so it can apply idempotency
     * safeguards on retries.
     */
    private async withRetry<T>(
        action: string,
        fn: (attempt: number) => Promise<T>,
    ): Promise<T> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                return await fn(attempt);
            } catch (e) {
                lastError = e;
                if (attempt < MAX_ATTEMPTS && this.isTransient(e)) {
                    const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
                    Logger.warn(
                        `Transient error while attempting to ${action} ` +
                            `(attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${delayMs}ms`,
                        loggerCtx,
                    );
                    await sleep(delayMs);
                    continue;
                }
                throw e;
            }
        }
        throw lastError;
    }

    /** Determines whether an error is worth retrying. */
    private isTransient(e: unknown): boolean {
        if (e instanceof ApiError) {
            const status = e.statusCode;
            return status === 429 || (typeof status === 'number' && status >= 500);
        }
        const code = (e as { code?: unknown })?.code;
        const message = e instanceof Error ? e.message : '';
        return TRANSIENT_NETWORK_CODES.some(c => code === c || message.includes(c));
    }

    /** Detects the PayPal "authorization already captured" business error. */
    private isAlreadyCaptured(e: unknown): boolean {
        if (!(e instanceof ApiError) || e.statusCode !== 422) {
            return false;
        }
        const detail = e instanceof CustomError ? safeStringify(e.result) : safeStringify(e.body);
        return detail.includes('AUTHORIZATION_ALREADY_CAPTURED');
    }

    /**
     * Normalises any thrown SDK value into a single `Error` with a safe,
     * descriptive message, while logging the structured PayPal error detail.
     * Credentials are never included in the message or the log.
     */
    private toError(action: string, e: unknown): Error {
        if (e instanceof ApiError) {
            const detail = e instanceof CustomError ? safeStringify(e.result) : e.message;
            Logger.error(
                `Failed to ${action} (status ${e.statusCode}): ${detail}`,
                loggerCtx,
            );
            return new Error(`Failed to ${action}: PayPal returned status ${e.statusCode}`);
        }
        const message = e instanceof Error ? e.message : String(e);
        Logger.error(`Failed to ${action}: ${message}`, loggerCtx);
        return new Error(`Failed to ${action}: ${message}`);
    }
}

/** Maximum number of attempts (initial try + retries) for a PayPal call. */
const MAX_ATTEMPTS = 3;

/** Base delay in milliseconds for exponential backoff between retries. */
const RETRY_BASE_DELAY_MS = 200;

/** Node network error codes considered transient and therefore retryable. */
const TRANSIENT_NETWORK_CODES = [
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'ENETUNREACH',
    'EAI_AGAIN',
    'EPIPE',
];

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
