import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@vendure/core';
import {
    ApiError,
    CheckoutPaymentIntent,
    Client,
    CustomError,
    Environment,
    LogLevel,
    Order as PayPalOrder,
    OrdersController,
} from '@paypal/paypal-server-sdk';

import { loggerCtx, PAYPAL_PLUGIN_OPTIONS } from './constants';
import { CapturePayPalOrderResult, CreatePayPalOrderResult, PayPalPluginOptions } from './types';

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
    }

    /**
     * @description
     * Creates a PayPal order with `CAPTURE` intent for the given amount and
     * returns the order id and the buyer approval URL.
     *
     * @param amountMinorUnits The amount in integer minor units (e.g. `1000` = $10.00).
     * @param currencyCode The three-character ISO-4217 currency code.
     * @param referenceId An opaque reference (the Vendure order code) attached to
     * the PayPal order for reconciliation.
     */
    async createOrder(
        amountMinorUnits: number,
        currencyCode: string,
        referenceId: string,
    ): Promise<CreatePayPalOrderResult> {
        let result: PayPalOrder;
        try {
            const response = await this.ordersController.createOrder({
                body: {
                    intent: CheckoutPaymentIntent.Capture,
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
            });
            result = response.result;
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
            const response = await this.ordersController.captureOrder({
                id: paypalOrderId,
                prefer: 'return=representation',
            });
            result = response.result;
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

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
