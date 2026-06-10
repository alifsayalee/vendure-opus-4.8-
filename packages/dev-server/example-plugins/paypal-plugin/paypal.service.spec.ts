import { beforeEach, describe, expect, it, vi } from 'vitest';

const createOrderMock = vi.fn();
const captureOrderMock = vi.fn();
const authorizeOrderMock = vi.fn();
const getOrderMock = vi.fn();
const captureAuthorizedPaymentMock = vi.fn();
const getAuthorizedPaymentMock = vi.fn();
const voidPaymentMock = vi.fn();
const refundCapturedPaymentMock = vi.fn();
const createBillingPlanMock = vi.fn();
const activateBillingPlanMock = vi.fn();
const deactivateBillingPlanMock = vi.fn();
const updateBillingPlanPricingSchemesMock = vi.fn();
const patchBillingPlanMock = vi.fn();
const createSubscriptionMock = vi.fn();
const getSubscriptionMock = vi.fn();
const activateSubscriptionMock = vi.fn();
const suspendSubscriptionMock = vi.fn();
const cancelSubscriptionMock = vi.fn();
const captureSubscriptionMock = vi.fn();
const searchTransactionsMock = vi.fn();
const searchBalancesMock = vi.fn();
const createOrderTrackingMock = vi.fn();

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
            createOrderTracking = createOrderTrackingMock;
        },
        PaymentsController: class {
            captureAuthorizedPayment = captureAuthorizedPaymentMock;
            getAuthorizedPayment = getAuthorizedPaymentMock;
            voidPayment = voidPaymentMock;
            refundCapturedPayment = refundCapturedPaymentMock;
        },
        SubscriptionsController: class {
            createBillingPlan = createBillingPlanMock;
            activateBillingPlan = activateBillingPlanMock;
            deactivateBillingPlan = deactivateBillingPlanMock;
            updateBillingPlanPricingSchemes = updateBillingPlanPricingSchemesMock;
            patchBillingPlan = patchBillingPlanMock;
            createSubscription = createSubscriptionMock;
            getSubscription = getSubscriptionMock;
            activateSubscription = activateSubscriptionMock;
            suspendSubscription = suspendSubscriptionMock;
            cancelSubscription = cancelSubscriptionMock;
            captureSubscription = captureSubscriptionMock;
        },
        TransactionSearchController: class {
            searchTransactions = searchTransactionsMock;
            searchBalances = searchBalancesMock;
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
        createBillingPlanMock.mockReset();
        activateBillingPlanMock.mockReset();
        deactivateBillingPlanMock.mockReset();
        updateBillingPlanPricingSchemesMock.mockReset();
        patchBillingPlanMock.mockReset();
        createSubscriptionMock.mockReset();
        getSubscriptionMock.mockReset();
        activateSubscriptionMock.mockReset();
        suspendSubscriptionMock.mockReset();
        cancelSubscriptionMock.mockReset();
        captureSubscriptionMock.mockReset();
        searchTransactionsMock.mockReset();
        searchBalancesMock.mockReset();
        createOrderTrackingMock.mockReset();
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

    describe('subscriptions (Use Case 6)', () => {
        it('creates an ACTIVE billing plan with one fixed-price regular cycle', async () => {
            createBillingPlanMock.mockResolvedValue({ result: { id: 'P-1', status: 'ACTIVE' } });

            const result = await createService().createBillingPlan(
                {
                    productId: 'PROD-1',
                    name: 'Monthly',
                    amountMinorUnits: 999,
                    currencyCode: 'USD',
                    intervalUnit: 'MONTH',
                    intervalCount: 1,
                    paymentFailureThreshold: 2,
                    activateImmediately: true,
                },
                'plan-key',
            );

            expect(result).toEqual({ planId: 'P-1', status: 'ACTIVE' });
            const body = createBillingPlanMock.mock.calls[0][0].body;
            expect(body.status).toBe('ACTIVE');
            expect(body.billingCycles[0].frequency).toEqual({ intervalUnit: 'MONTH', intervalCount: 1 });
            expect(body.billingCycles[0].tenureType).toBe('REGULAR');
            expect(body.billingCycles[0].pricingScheme.fixedPrice).toEqual({
                currencyCode: 'USD',
                value: '9.99',
            });
            expect(body.paymentPreferences.paymentFailureThreshold).toBe(2);
            expect(createBillingPlanMock.mock.calls[0][0].paypalRequestId).toBe('plan-key');
        });

        it('creates a subscription and extracts the approval URL and status', async () => {
            // The SDK strips the undeclared `status` from `result`; it is only
            // present in the raw response body.
            createSubscriptionMock.mockResolvedValue({
                result: {
                    id: 'SUB-1',
                    planId: 'P-1',
                    links: [
                        { rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=X' },
                    ],
                },
                body: JSON.stringify({ id: 'SUB-1', status: 'APPROVAL_PENDING' }),
            });

            const result = await createService().createSubscription(
                { planId: 'P-1', brandName: 'Shop' },
                'sub-key',
            );

            expect(result).toEqual({
                subscriptionId: 'SUB-1',
                status: 'APPROVAL_PENDING',
                planId: 'P-1',
                approvalUrl: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=X',
            });
            const passed = createSubscriptionMock.mock.calls[0][0];
            expect(passed.paypalRequestId).toBe('sub-key');
            expect(passed.body.applicationContext).toMatchObject({
                returnUrl: options.returnUrl,
                cancelUrl: options.cancelUrl,
                brandName: 'Shop',
            });
        });

        it('reads subscription status from the raw body when the SDK strips it from result', async () => {
            // Reproduces the real SDK behaviour: `result` has no `status` (the
            // model does not declare it), but the raw body does. Regression test
            // for sync returning APPROVAL_PENDING for an ACTIVE subscription.
            getSubscriptionMock.mockResolvedValue({
                result: { id: 'SUB-1', planId: 'P-1' },
                body: JSON.stringify({ id: 'SUB-1', plan_id: 'P-1', status: 'ACTIVE' }),
            });
            const result = await createService().getSubscription('SUB-1');
            expect(result).toEqual({ subscriptionId: 'SUB-1', status: 'ACTIVE', planId: 'P-1' });
        });

        it('falls back to the typed result status when no body is present', async () => {
            getSubscriptionMock.mockResolvedValue({ result: { id: 'SUB-1', planId: 'P-1', status: 'SUSPENDED' } });
            const result = await createService().getSubscription('SUB-1');
            expect(result.status).toBe('SUSPENDED');
        });

        it('updates plan pricing with a fixed price for the billing cycle', async () => {
            updateBillingPlanPricingSchemesMock.mockResolvedValue({ result: undefined });
            await createService().updatePlanPricing('P-1', 1500, 'USD');
            const passed = updateBillingPlanPricingSchemesMock.mock.calls[0][0];
            expect(passed.id).toBe('P-1');
            expect(passed.body.pricingSchemes[0]).toEqual({
                billingCycleSequence: 1,
                pricingScheme: { fixedPrice: { currencyCode: 'USD', value: '15.00' } },
            });
        });

        it('patches the payment failure threshold via a replace op', async () => {
            patchBillingPlanMock.mockResolvedValue({ result: undefined });
            await createService().updatePlanPaymentFailureThreshold('P-1', 3);
            expect(patchBillingPlanMock.mock.calls[0][0].body).toEqual([
                { op: 'replace', path: '/payment_preferences/payment_failure_threshold', value: 3 },
            ]);
        });

        it('cancels a subscription with a reason', async () => {
            cancelSubscriptionMock.mockResolvedValue({ result: undefined });
            await createService().cancelSubscription('SUB-1', 'Customer request');
            expect(cancelSubscriptionMock.mock.calls[0][0]).toEqual({
                id: 'SUB-1',
                body: { reason: 'Customer request' },
            });
        });

        it('captures the outstanding balance to retry a failed payment', async () => {
            captureSubscriptionMock.mockResolvedValue({ result: null });
            await createService().captureSubscriptionPayment('SUB-1', 999, 'USD', 'Retry');
            expect(captureSubscriptionMock.mock.calls[0][0]).toEqual({
                id: 'SUB-1',
                body: { note: 'Retry', captureType: 'OUTSTANDING_BALANCE', amount: { currencyCode: 'USD', value: '9.99' } },
            });
        });

        it('wraps subscription SDK errors with a safe message', async () => {
            createSubscriptionMock.mockRejectedValue(new Error('plan inactive'));
            await expect(
                createService().createSubscription({ planId: 'P-1' }, 'k'),
            ).rejects.toThrow(/Failed to create the subscription: plan inactive/);
        });
    });

    describe('transaction reporting (Use Case 7)', () => {
        const txDetail = (id: string, value: string) => ({
            transactionInfo: {
                transactionId: id,
                transactionStatus: 'S',
                transactionEventCode: 'T0006',
                transactionInitiationDate: '2024-01-05T10:00:00Z',
                transactionAmount: { currencyCode: 'USD', value },
                feeAmount: { currencyCode: 'USD', value: '-0.50' },
            },
        });

        it('normalizes transactions for a single-window range', async () => {
            searchTransactionsMock.mockResolvedValue({
                result: {
                    totalPages: 1,
                    lastRefreshedDatetime: '2024-01-10T00:00:00Z',
                    transactionDetails: [txDetail('TX-1', '10.00')],
                },
            });

            const report = await createService().searchTransactions(
                '2024-01-01T00:00:00.000Z',
                '2024-01-15T00:00:00.000Z',
            );

            expect(report.totalItems).toBe(1);
            expect(report.lastRefreshedAt).toBe('2024-01-10T00:00:00Z');
            expect(report.transactions[0]).toEqual({
                transactionId: 'TX-1',
                status: 'S',
                eventCode: 'T0006',
                initiationDate: '2024-01-05T10:00:00Z',
                updatedDate: undefined,
                currencyCode: 'USD',
                value: '10.00',
                feeCurrencyCode: 'USD',
                feeValue: '-0.50',
            });
            expect(searchTransactionsMock).toHaveBeenCalledTimes(1);
        });

        it('paginates within a window until all pages are fetched', async () => {
            searchTransactionsMock
                .mockResolvedValueOnce({ result: { totalPages: 2, transactionDetails: [txDetail('TX-1', '10.00')] } })
                .mockResolvedValueOnce({ result: { totalPages: 2, transactionDetails: [txDetail('TX-2', '20.00')] } });

            const report = await createService().searchTransactions(
                '2024-01-01T00:00:00.000Z',
                '2024-01-10T00:00:00.000Z',
            );

            expect(report.totalItems).toBe(2);
            expect(searchTransactionsMock).toHaveBeenCalledTimes(2);
            expect(searchTransactionsMock.mock.calls[0][0].page).toBe(1);
            expect(searchTransactionsMock.mock.calls[1][0].page).toBe(2);
        });

        it('splits a range longer than 31 days into multiple windows', async () => {
            searchTransactionsMock.mockResolvedValue({
                result: { totalPages: 1, transactionDetails: [txDetail('TX-W', '5.00')] },
            });

            const report = await createService().searchTransactions(
                '2024-01-01T00:00:00.000Z',
                '2024-02-10T00:00:00.000Z', // 40 days
            );

            expect(searchTransactionsMock).toHaveBeenCalledTimes(2);
            expect(searchTransactionsMock.mock.calls[0][0]).toMatchObject({
                startDate: '2024-01-01T00:00:00.000Z',
                endDate: '2024-02-01T00:00:00.000Z',
            });
            expect(searchTransactionsMock.mock.calls[1][0]).toMatchObject({
                startDate: '2024-02-01T00:00:00.000Z',
                endDate: '2024-02-10T00:00:00.000Z',
            });
            expect(report.totalItems).toBe(2);
        });

        it('rejects an invalid date range', async () => {
            await expect(
                createService().searchTransactions('2024-02-01T00:00:00Z', '2024-01-01T00:00:00Z'),
            ).rejects.toThrow(/startDate must be before endDate/);
            expect(searchTransactionsMock).not.toHaveBeenCalled();
        });

        it('wraps transaction-search SDK errors with a safe message', async () => {
            searchTransactionsMock.mockRejectedValue(new Error('rate limited'));
            await expect(
                createService().searchTransactions('2024-01-01T00:00:00Z', '2024-01-10T00:00:00Z'),
            ).rejects.toThrow(/Failed to search transactions: rate limited/);
        });

        it('maps account balances', async () => {
            searchBalancesMock.mockResolvedValue({
                result: {
                    accountId: 'ACC-1',
                    asOfTime: '2024-01-10T00:00:00Z',
                    lastRefreshTime: '2024-01-10T00:00:00Z',
                    balances: [
                        {
                            currency: 'USD',
                            primary: true,
                            totalBalance: { currencyCode: 'USD', value: '100.00' },
                            availableBalance: { currencyCode: 'USD', value: '90.00' },
                            withheldBalance: { currencyCode: 'USD', value: '10.00' },
                        },
                    ],
                },
            });

            const report = await createService().getBalances();

            expect(report.accountId).toBe('ACC-1');
            expect(report.balances[0]).toEqual({
                currency: 'USD',
                primary: true,
                totalCurrencyCode: 'USD',
                totalValue: '100.00',
                availableCurrencyCode: 'USD',
                availableValue: '90.00',
                withheldCurrencyCode: 'USD',
                withheldValue: '10.00',
            });
        });

        it('passes asOfTime and currencyCode through to the SDK', async () => {
            searchBalancesMock.mockResolvedValue({ result: { balances: [] } });
            await createService().getBalances('2024-01-01T00:00:00Z', 'EUR');
            expect(searchBalancesMock.mock.calls[0][0]).toEqual({
                asOfTime: '2024-01-01T00:00:00Z',
                currencyCode: 'EUR',
            });
        });
    });

    describe('addOrderTracking (Use Case 8)', () => {
        it('uses a known carrier when the method matches a PayPal carrier', async () => {
            createOrderTrackingMock.mockResolvedValue({ result: { id: 'O-1' } });

            await createService().addOrderTracking('O-1', 'CAP-1', {
                trackingNumber: 'TRK-1',
                carrierMethod: 'UPS',
                notifyPayer: true,
            });

            expect(createOrderTrackingMock.mock.calls[0][0]).toEqual({
                id: 'O-1',
                body: {
                    captureId: 'CAP-1',
                    trackingNumber: 'TRK-1',
                    carrier: 'UPS',
                    notifyPayer: true,
                },
            });
        });

        it('falls back to OTHER + carrierNameOther for an unknown carrier', async () => {
            createOrderTrackingMock.mockResolvedValue({ result: { id: 'O-1' } });

            await createService().addOrderTracking('O-1', 'CAP-1', {
                trackingNumber: 'TRK-2',
                carrierMethod: 'Standard Shipping',
            });

            expect(createOrderTrackingMock.mock.calls[0][0].body).toEqual({
                captureId: 'CAP-1',
                trackingNumber: 'TRK-2',
                carrier: 'OTHER',
                carrierNameOther: 'Standard Shipping',
                notifyPayer: true,
            });
        });

        it('wraps tracking SDK errors with a safe message', async () => {
            createOrderTrackingMock.mockRejectedValue(new Error('order not found'));
            await expect(
                createService().addOrderTracking('O-1', 'CAP-1', { carrierMethod: 'UPS' }),
            ).rejects.toThrow(/Failed to add tracking to the PayPal order: order not found/);
        });
    });
});
