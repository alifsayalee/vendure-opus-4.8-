import { beforeEach, describe, expect, it, vi } from 'vitest';

const createOrderMock = vi.fn();
const captureOrderMock = vi.fn();
const authorizeOrderMock = vi.fn();
const getOrderMock = vi.fn();
const captureAuthorizedPaymentMock = vi.fn();
const getAuthorizedPaymentMock = vi.fn();
const voidPaymentMock = vi.fn();
const refundCapturedPaymentMock = vi.fn();

// Mock the PayPal SDK: keep the real enums/error classes, but replace the
// network-facing Client and controllers with controllable stubs.
vi.mock('@paypal/paypal-server-sdk', async importOriginal => {
    const actual = await importOriginal<typeof import('@paypal/paypal-server-sdk')>();
    return {
        ...actual,
        Client: class {},
        OrdersController: class {
            createOrder = createOrderMock;
            captureOrder = captureOrderMock;
            authorizeOrder = authorizeOrderMock;
            getOrder = getOrderMock;
        },
        PaymentsController: class {
            captureAuthorizedPayment = captureAuthorizedPaymentMock;
            getAuthorizedPayment = getAuthorizedPaymentMock;
            voidPayment = voidPaymentMock;
            refundCapturedPayment = refundCapturedPaymentMock;
        },
    };
});

/** A Node-style transient network error, as thrown on a connection timeout. */
function transientError(message = 'connect ETIMEDOUT 151.101.143.1:443'): Error {
    const err = new Error(message) as Error & { code?: string };
    err.code = 'ETIMEDOUT';
    return err;
}

// Avoid bootstrapping the full Vendure runtime just to access the logger.
vi.mock('@vendure/core', () => ({
    Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Imported after the mocks are registered.
import { PayPalService } from './paypal.service';
import { PayPalPluginOptions } from './types';

const options: PayPalPluginOptions = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    environment: 'sandbox',
    returnUrl: 'https://shop.example/return',
    cancelUrl: 'https://shop.example/cancel',
    brandName: 'Example Store',
};

function createService(): PayPalService {
    return new PayPalService(options);
}

describe('PayPalService', () => {
    beforeEach(() => {
        createOrderMock.mockReset();
        captureOrderMock.mockReset();
        authorizeOrderMock.mockReset();
        getOrderMock.mockReset();
        captureAuthorizedPaymentMock.mockReset();
        getAuthorizedPaymentMock.mockReset();
        voidPaymentMock.mockReset();
        refundCapturedPaymentMock.mockReset();
    });

    describe('createOrder', () => {
        it('creates a CAPTURE-intent order and returns the approval URL', async () => {
            createOrderMock.mockResolvedValue({
                result: {
                    id: 'PAYPAL-ORDER-1',
                    status: 'CREATED',
                    links: [
                        { rel: 'self', href: 'https://api.paypal.com/v2/checkout/orders/PAYPAL-ORDER-1' },
                        { rel: 'approve', href: 'https://www.paypal.com/checkoutnow?token=PAYPAL-ORDER-1' },
                    ],
                },
            });

            const service = createService();
            const result = await service.createOrder(1000, 'USD', 'ORDER-CODE-1');

            expect(result).toEqual({
                paypalOrderId: 'PAYPAL-ORDER-1',
                status: 'CREATED',
                approvalUrl: 'https://www.paypal.com/checkoutnow?token=PAYPAL-ORDER-1',
            });

            const passed = createOrderMock.mock.calls[0][0];
            expect(passed.body.intent).toBe('CAPTURE');
            expect(passed.body.purchaseUnits[0]).toMatchObject({
                referenceId: 'ORDER-CODE-1',
                amount: { currencyCode: 'USD', value: '10.00' },
            });
            expect(passed.body.paymentSource.paypal.experienceContext).toMatchObject({
                returnUrl: 'https://shop.example/return',
                cancelUrl: 'https://shop.example/cancel',
                brandName: 'Example Store',
            });
        });

        it('falls back to the payer-action link when no approve link is present', async () => {
            createOrderMock.mockResolvedValue({
                result: {
                    id: 'PAYPAL-ORDER-2',
                    status: 'PAYER_ACTION_REQUIRED',
                    links: [{ rel: 'payer-action', href: 'https://www.paypal.com/payer-action' }],
                },
            });

            const result = await createService().createOrder(500, 'USD', 'ORDER-CODE-2');
            expect(result.approvalUrl).toBe('https://www.paypal.com/payer-action');
        });

        it('formats zero-decimal currencies without fractional digits', async () => {
            createOrderMock.mockResolvedValue({
                result: { id: 'X', status: 'CREATED', links: [{ rel: 'approve', href: 'https://x' }] },
            });

            await createService().createOrder(1000, 'JPY', 'ORDER-JPY');
            const passed = createOrderMock.mock.calls[0][0];
            expect(passed.body.purchaseUnits[0].amount).toEqual({ currencyCode: 'JPY', value: '1000' });
        });

        it('uses AUTHORIZE intent when requested', async () => {
            createOrderMock.mockResolvedValue({
                result: { id: 'X', status: 'CREATED', links: [{ rel: 'approve', href: 'https://x' }] },
            });

            await createService().createOrder(1000, 'USD', 'ORDER-AUTH', 'authorize');
            expect(createOrderMock.mock.calls[0][0].body.intent).toBe('AUTHORIZE');
        });

        it('throws when PayPal returns no approval URL', async () => {
            createOrderMock.mockResolvedValue({ result: { id: 'PAYPAL-ORDER-3', status: 'CREATED', links: [] } });
            await expect(createService().createOrder(1000, 'USD', 'ORDER-3')).rejects.toThrow(
                /buyer approval URL/,
            );
        });

        it('throws when PayPal returns no order id', async () => {
            createOrderMock.mockResolvedValue({ result: { status: 'CREATED', links: [] } });
            await expect(createService().createOrder(1000, 'USD', 'ORDER-4')).rejects.toThrow(/order id/);
        });

        it('wraps SDK errors with a safe message', async () => {
            createOrderMock.mockRejectedValue(new Error('network down'));
            await expect(createService().createOrder(1000, 'USD', 'ORDER-5')).rejects.toThrow(
                /Failed to create the PayPal order: network down/,
            );
        });
    });

    describe('captureOrder', () => {
        it('returns the capture id and status on success', async () => {
            captureOrderMock.mockResolvedValue({
                result: {
                    id: 'PAYPAL-ORDER-1',
                    status: 'COMPLETED',
                    purchaseUnits: [
                        {
                            payments: {
                                captures: [
                                    {
                                        id: 'CAPTURE-1',
                                        status: 'COMPLETED',
                                        amount: { currencyCode: 'USD', value: '10.00' },
                                    },
                                ],
                            },
                        },
                    ],
                },
            });

            const result = await createService().captureOrder('PAYPAL-ORDER-1');
            expect(result).toEqual({
                paypalOrderId: 'PAYPAL-ORDER-1',
                orderStatus: 'COMPLETED',
                captureId: 'CAPTURE-1',
                captureStatus: 'COMPLETED',
                currencyCode: 'USD',
                value: '10.00',
            });
            expect(captureOrderMock.mock.calls[0][0]).toMatchObject({
                id: 'PAYPAL-ORDER-1',
                paypalRequestId: 'capture-order-PAYPAL-ORDER-1',
            });
        });

        it('throws when the response contains no capture', async () => {
            captureOrderMock.mockResolvedValue({
                result: { id: 'PAYPAL-ORDER-1', status: 'COMPLETED', purchaseUnits: [{ payments: {} }] },
            });
            await expect(createService().captureOrder('PAYPAL-ORDER-1')).rejects.toThrow(/completed capture/);
        });

        it('wraps SDK errors with a safe message', async () => {
            captureOrderMock.mockRejectedValue(new Error('boom'));
            await expect(createService().captureOrder('PAYPAL-ORDER-1')).rejects.toThrow(
                /Failed to capture the PayPal order: boom/,
            );
        });
    });

    describe('authorizeOrder', () => {
        it('returns the authorization id and status on success', async () => {
            authorizeOrderMock.mockResolvedValue({
                result: {
                    id: 'PAYPAL-ORDER-2',
                    status: 'COMPLETED',
                    purchaseUnits: [
                        {
                            payments: {
                                authorizations: [
                                    {
                                        id: 'AUTH-1',
                                        status: 'CREATED',
                                        amount: { currencyCode: 'USD', value: '10.00' },
                                    },
                                ],
                            },
                        },
                    ],
                },
            });

            const result = await createService().authorizeOrder('PAYPAL-ORDER-2');
            expect(result).toEqual({
                paypalOrderId: 'PAYPAL-ORDER-2',
                orderStatus: 'COMPLETED',
                authorizationId: 'AUTH-1',
                authorizationStatus: 'CREATED',
                currencyCode: 'USD',
                value: '10.00',
            });
            expect(authorizeOrderMock.mock.calls[0][0]).toMatchObject({
                id: 'PAYPAL-ORDER-2',
                paypalRequestId: 'authorize-PAYPAL-ORDER-2',
            });
        });

        it('throws when the response contains no authorization', async () => {
            authorizeOrderMock.mockResolvedValue({
                result: { id: 'PAYPAL-ORDER-2', status: 'COMPLETED', purchaseUnits: [{ payments: {} }] },
            });
            await expect(createService().authorizeOrder('PAYPAL-ORDER-2')).rejects.toThrow(
                /did not contain an authorization/,
            );
        });

        it('wraps SDK errors with a safe message', async () => {
            authorizeOrderMock.mockRejectedValue(new Error('bang'));
            await expect(createService().authorizeOrder('PAYPAL-ORDER-2')).rejects.toThrow(
                /Failed to authorize the PayPal order: bang/,
            );
        });
    });

    describe('captureAuthorization', () => {
        it('captures an authorization with finalCapture and returns the capture id', async () => {
            captureAuthorizedPaymentMock.mockResolvedValue({
                result: { id: 'CAPTURE-9', status: 'COMPLETED', amount: { currencyCode: 'USD', value: '10.00' } },
            });

            const result = await createService().captureAuthorization('AUTH-1');
            expect(result).toEqual({
                captureId: 'CAPTURE-9',
                captureStatus: 'COMPLETED',
                currencyCode: 'USD',
                value: '10.00',
            });
            expect(captureAuthorizedPaymentMock.mock.calls[0][0]).toMatchObject({
                authorizationId: 'AUTH-1',
                body: { finalCapture: true },
            });
        });

        it('throws when the response contains no capture', async () => {
            captureAuthorizedPaymentMock.mockResolvedValue({ result: {} });
            await expect(createService().captureAuthorization('AUTH-1')).rejects.toThrow(
                /did not contain a capture/,
            );
        });

        it('wraps SDK errors with a safe message', async () => {
            captureAuthorizedPaymentMock.mockRejectedValue(new Error('nope'));
            await expect(createService().captureAuthorization('AUTH-1')).rejects.toThrow(
                /Failed to capture the authorized PayPal payment: nope/,
            );
        });
    });

    describe('voidAuthorization', () => {
        it('voids an authorization and returns VOIDED with an idempotency key', async () => {
            voidPaymentMock.mockResolvedValue({ result: { id: 'AUTH-1', status: 'VOIDED' } });

            const result = await createService().voidAuthorization('AUTH-1');

            expect(result).toEqual({ authorizationId: 'AUTH-1', status: 'VOIDED' });
            expect(voidPaymentMock.mock.calls[0][0]).toMatchObject({
                authorizationId: 'AUTH-1',
                paypalRequestId: 'void-AUTH-1',
            });
        });

        it('treats a null result (return=minimal / 204) as a successful void', async () => {
            voidPaymentMock.mockResolvedValue({ result: null });

            const result = await createService().voidAuthorization('AUTH-1');
            expect(result).toEqual({ authorizationId: 'AUTH-1', status: 'VOIDED' });
        });

        it('wraps SDK errors (e.g. already captured) with a safe message', async () => {
            voidPaymentMock.mockRejectedValue(new Error('already captured'));
            await expect(createService().voidAuthorization('AUTH-1')).rejects.toThrow(
                /Failed to void the authorized PayPal payment: already captured/,
            );
        });
    });

    describe('refundCapture', () => {
        it('issues a full refund with no amount body and the given idempotency key', async () => {
            refundCapturedPaymentMock.mockResolvedValue({
                result: { id: 'REFUND-1', status: 'COMPLETED', amount: { currencyCode: 'USD', value: '10.00' } },
            });

            const result = await createService().refundCapture('CAPTURE-1', 'refund-CAPTURE-1-0');

            expect(result).toEqual({
                refundId: 'REFUND-1',
                status: 'COMPLETED',
                currencyCode: 'USD',
                value: '10.00',
            });
            const passed = refundCapturedPaymentMock.mock.calls[0][0];
            expect(passed.captureId).toBe('CAPTURE-1');
            expect(passed.body).toBeUndefined(); // full refund => no amount
            expect(passed.paypalRequestId).toBe('refund-CAPTURE-1-0');
        });

        it('sends the amount for a partial refund and forwards the idempotency key', async () => {
            refundCapturedPaymentMock.mockResolvedValue({
                result: { id: 'REFUND-2', status: 'COMPLETED', amount: { currencyCode: 'USD', value: '4.00' } },
            });

            await createService().refundCapture('CAPTURE-1', 'refund-CAPTURE-1-1', {
                amountMinorUnits: 400,
                currencyCode: 'USD',
            });

            const passed = refundCapturedPaymentMock.mock.calls[0][0];
            expect(passed.body).toEqual({ amount: { currencyCode: 'USD', value: '4.00' } });
            expect(passed.paypalRequestId).toBe('refund-CAPTURE-1-1');
        });

        it('throws when the refund response contains no refund', async () => {
            refundCapturedPaymentMock.mockResolvedValue({ result: {} });
            await expect(createService().refundCapture('CAPTURE-1', 'k')).rejects.toThrow(
                /did not contain a refund/,
            );
        });

        it('wraps SDK errors with a safe message', async () => {
            refundCapturedPaymentMock.mockRejectedValue(new Error('refund boom'));
            await expect(createService().refundCapture('CAPTURE-1', 'k')).rejects.toThrow(
                /Failed to refund the captured PayPal payment: refund boom/,
            );
        });
    });

    describe('resilience (retry + idempotency)', () => {
        it('retries a transient timeout and succeeds on the next attempt', async () => {
            // First attempt times out before PayPal captures; the pre-retry status
            // check shows the authorization is still uncaptured, so the retry
            // performs the capture and succeeds.
            captureAuthorizedPaymentMock
                .mockRejectedValueOnce(transientError())
                .mockResolvedValueOnce({
                    result: { id: 'CAPTURE-RETRY', status: 'COMPLETED', amount: { currencyCode: 'USD', value: '10.00' } },
                });
            getAuthorizedPaymentMock.mockResolvedValue({ result: { status: 'CREATED' } });

            const result = await createService().captureAuthorization('AUTH-1', 'PAYPAL-ORDER-1');

            expect(result.captureId).toBe('CAPTURE-RETRY');
            expect(captureAuthorizedPaymentMock).toHaveBeenCalledTimes(2);
        });

        it('does not double-capture: recovers the existing capture after a timed-out success', async () => {
            // First attempt times out AFTER PayPal captured. On retry the status
            // check reports CAPTURED, so we recover the capture from the order and
            // never call capture again.
            captureAuthorizedPaymentMock.mockRejectedValueOnce(transientError());
            getAuthorizedPaymentMock.mockResolvedValue({ result: { status: 'CAPTURED' } });
            getOrderMock.mockResolvedValue({
                result: {
                    purchaseUnits: [
                        {
                            payments: {
                                captures: [
                                    { id: 'CAPTURE-EXISTING', status: 'COMPLETED', amount: { currencyCode: 'USD', value: '10.00' } },
                                ],
                            },
                        },
                    ],
                },
            });

            const result = await createService().captureAuthorization('AUTH-1', 'PAYPAL-ORDER-1');

            expect(result).toEqual({
                captureId: 'CAPTURE-EXISTING',
                captureStatus: 'COMPLETED',
                currencyCode: 'USD',
                value: '10.00',
            });
            // The capture endpoint was only hit once (the timed-out attempt).
            expect(captureAuthorizedPaymentMock).toHaveBeenCalledTimes(1);
            expect(getOrderMock).toHaveBeenCalledWith({ id: 'PAYPAL-ORDER-1' });
        });

        it('does not retry non-transient errors', async () => {
            captureOrderMock.mockRejectedValue(new Error('bad request'));

            await expect(createService().captureOrder('PAYPAL-ORDER-1')).rejects.toThrow(
                /Failed to capture the PayPal order/,
            );
            expect(captureOrderMock).toHaveBeenCalledTimes(1);
        });

        it('retries createOrder on a transient timeout', async () => {
            createOrderMock.mockRejectedValueOnce(transientError()).mockResolvedValueOnce({
                result: { id: 'O', status: 'CREATED', links: [{ rel: 'approve', href: 'https://x' }] },
            });

            const result = await createService().createOrder(1000, 'USD', 'ORDER-RETRY');

            expect(result.paypalOrderId).toBe('O');
            expect(createOrderMock).toHaveBeenCalledTimes(2);
        });
    });
});
