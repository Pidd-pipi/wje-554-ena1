import { OrderStatus } from './enums';

/**
 * 订单状态机（与后端 order.state-machine.ts 保持一致）。
 * 页面据此只展示当前真实状态下允许的操作，后端会对每个入口做同样的校验。
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.ASSIGNED, OrderStatus.CANCELLED],
  [OrderStatus.ASSIGNED]: [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]: [OrderStatus.ON_THE_WAY, OrderStatus.CANCELLED],
  [OrderStatus.ON_THE_WAY]: [OrderStatus.IN_PROGRESS, OrderStatus.CANCELLED],
  [OrderStatus.IN_PROGRESS]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [OrderStatus.RATED],
  [OrderStatus.RATED]: [],
  [OrderStatus.CANCELLED]: []
};

export const canOrderTransition = (from: OrderStatus, to: OrderStatus): boolean => ORDER_TRANSITIONS[from]?.includes(to) ?? false;

/** 订单完成后（COMPLETED/RATED）以及已取消的订单不能再取消 */
export const canCancelOrder = (status: OrderStatus): boolean => canOrderTransition(status, OrderStatus.CANCELLED);

/** 仅已完工订单可评价；已取消订单不能补评价 */
export const canRateOrder = (status: OrderStatus): boolean => canOrderTransition(status, OrderStatus.RATED);
