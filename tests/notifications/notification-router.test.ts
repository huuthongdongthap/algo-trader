import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationRouter, type ChannelNotifier } from '../../src/notifications/notification-router.js';

function mockNotifier(): ChannelNotifier & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sendMessage: vi.fn(async (text: string) => { calls.push(`msg:${text}`); }),
    sendTradeAlert: vi.fn(async (trade: any) => { calls.push(`trade:${trade.orderId}`); }),
  };
}

const fakeTrade: any = {
  orderId: 'o-1', marketId: 'BTC-USDC', side: 'buy',
  fillPrice: '50000', fillSize: '1', fees: '5', timestamp: Date.now(), strategy: 'grid-trading',
};

describe('NotificationRouter', () => {
  let router: NotificationRouter;

  beforeEach(() => {
    router = new NotificationRouter();
  });

  it('should start with no enabled channels', () => {
    expect(router.enabledChannels()).toHaveLength(0);
  });

  it('should register and list enabled channels', () => {
    router.addChannel('telegram', mockNotifier());
    router.addChannel('discord', mockNotifier());
    expect(router.enabledChannels()).toEqual(['telegram', 'discord']);
  });

  it('should toggle channel enabled state', () => {
    router.addChannel('telegram', mockNotifier());
    router.setEnabled('telegram', false);
    expect(router.enabledChannels()).toHaveLength(0);
    router.setEnabled('telegram', true);
    expect(router.enabledChannels()).toEqual(['telegram']);
  });

  it('should send message to all enabled channels', async () => {
    const tg = mockNotifier();
    const dc = mockNotifier();
    router.addChannel('telegram', tg);
    router.addChannel('discord', dc);

    await router.send('Hello world');
    expect(tg.sendMessage).toHaveBeenCalledWith('Hello world');
    expect(dc.sendMessage).toHaveBeenCalledWith('Hello world');
  });

  it('should skip disabled channels', async () => {
    const tg = mockNotifier();
    const dc = mockNotifier();
    router.addChannel('telegram', tg);
    router.addChannel('discord', dc, false);

    await router.send('Test');
    expect(tg.sendMessage).toHaveBeenCalled();
    expect(dc.sendMessage).not.toHaveBeenCalled();
  });

  it('should send to explicit channel subset', async () => {
    const tg = mockNotifier();
    const dc = mockNotifier();
    router.addChannel('telegram', tg);
    router.addChannel('discord', dc);

    await router.send('Only discord', ['discord']);
    expect(tg.sendMessage).not.toHaveBeenCalled();
    expect(dc.sendMessage).toHaveBeenCalledWith('Only discord');
  });

  it('should broadcast trade alerts', async () => {
    const tg = mockNotifier();
    router.addChannel('telegram', tg);

    await router.sendTradeAlert(fakeTrade);
    expect(tg.sendTradeAlert).toHaveBeenCalledWith(fakeTrade);
  });

  it('should handle notifier errors gracefully', async () => {
    const broken: ChannelNotifier = {
      sendMessage: vi.fn(async () => { throw new Error('network error'); }),
      sendTradeAlert: vi.fn(async () => {}),
    };
    router.addChannel('slack', broken);
    // Should not throw
    await router.send('crash test');
    expect(broken.sendMessage).toHaveBeenCalled();
  });

  it('should replace channel when re-registered', () => {
    const v1 = mockNotifier();
    const v2 = mockNotifier();
    router.addChannel('telegram', v1);
    router.addChannel('telegram', v2);
    expect(router.enabledChannels()).toEqual(['telegram']);
  });

  it('should ignore setEnabled for unregistered channel', () => {
    router.setEnabled('email', true); // no-op, no error
    expect(router.enabledChannels()).toHaveLength(0);
  });
});
