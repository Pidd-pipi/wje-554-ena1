import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '../../constants/enums';

/**
 * 订单状态机：下单、派单、接单/完工、取消、评价等所有入口共享同一套状态判断。
 * 任何状态变更必须先经过 assertOrderTransition 校验，失败请求不得产生任何统计副作用。
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

/** 下单时订单进入状态机的初始状态 */
export const INITIAL_ORDER_STATUS = OrderStatus.PENDING;

export function canOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canOrderTransition(from, to)) {
    throw new BadRequestException(`订单不能从 ${from} 流转到 ${to}`);
  }
}
