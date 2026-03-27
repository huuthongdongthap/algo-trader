/**
 * Trading engine - Core logic for order execution
 */

export interface Order {
  symbol: string;
  quantity: number;
  price: number;
  side: 'buy' | 'sell';
  timestamp: Date;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

export class TradingEngine {
  private orders: Order[] = [];

  executeOrder(order: Order): OrderResult {
    if (order.quantity <= 0) {
      return { success: false, error: 'Quantity must be positive' };
    }

    if (order.price <= 0) {
      return { success: false, error: 'Price must be positive' };
    }

    this.orders.push(order);

    return {
      success: true,
      orderId: `ORD-${Date.now()}-${Math.random().toString(36).substring(7)}`
    };
  }

  getOrders(): Order[] {
    return [...this.orders];
  }

  clearOrders(): void {
    this.orders = [];
  }
}
