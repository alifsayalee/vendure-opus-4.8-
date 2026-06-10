import { beforeEach, describe, expect, it, vi } from 'vitest';

const createOrderMock = vi.fn();
const captureOrderMock = vi.fn();

// Mock the PayPal SDK: keep the real enums/error classes, but replace the
// network-facing Client and OrdersController with controllable stubs.
vi.mock('@paypal/paypal-server-sdk', async importOriginal => {
    const actual = await importOriginal<typeof import('@paypal/paypal-server-sdk')>();
    return {
        ...actual,
        Client: class {},
        OrdersController: class {
            createOrder = createOrderMock;
            captureOrder = captureOrderMock;
        },
    };
});

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
            expect(captureOrderMock.mock.calls[0][0]).toMatchObject({ id: 'PAYPAL-ORDER-1' });
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
});
