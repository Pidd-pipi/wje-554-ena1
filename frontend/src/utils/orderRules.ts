import { OrderStatus, UserRole } from '../constants/enums';
import { ServiceOrder } from '../types/order';

/**
 * 与后端 order.rules 保持一致的订单状态机，下单/派单/流转/完工/取消/评价共用。
 * 页面只按这里的判断展示允许的操作，不自行散落状态判断。
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

export function canTransit(from: OrderStatus, to: OrderStatus): boolean {
  return from !== to && ORDER_TRANSITIONS[from].includes(to);
}

/** 已完工/已评价/已取消均不能再取消。 */
export function canCancelStatus(status: OrderStatus): boolean {
  return status !== OrderStatus.COMPLETED && status !== OrderStatus.RATED && status !== OrderStatus.CANCELLED;
}

/** 当前用户是否可以取消该订单（管理员任意，客户仅限本人，技师不可）。 */
export function canCancelOrder(role: UserRole | undefined, userId: string | undefined, order: ServiceOrder): boolean {
  if (!role || !canCancelStatus(order.status)) return false;
  if (role === UserRole.ADMIN) return true;
  return role === UserRole.CUSTOMER && order.customerId === userId;
}

/** 仅订单客户在已完工且未评价时可评价。 */
export function canRateOrder(role: UserRole | undefined, userId: string | undefined, order: ServiceOrder): boolean {
  return role === UserRole.CUSTOMER && order.customerId === userId && order.status === OrderStatus.COMPLETED;
}

/** 仅管理员可对待派单订单派单。 */
export function canAssignOrder(role: UserRole | undefined, order: ServiceOrder): boolean {
  return role === UserRole.ADMIN && order.status === OrderStatus.PENDING;
}

/** 技师在下一个服务节点上的推进动作。 */
export const WORKER_ACTIONS: Partial<Record<OrderStatus, { label: string; next: OrderStatus }>> = {
  [OrderStatus.ASSIGNED]: { label: '接单', next: OrderStatus.ACCEPTED },
  [OrderStatus.ACCEPTED]: { label: '出发', next: OrderStatus.ON_THE_WAY },
  [OrderStatus.ON_THE_WAY]: { label: '开始服务', next: OrderStatus.IN_PROGRESS },
  [OrderStatus.IN_PROGRESS]: { label: '完工', next: OrderStatus.COMPLETED }
};

/** 当前技师是否能对订单执行推进（技师本人且存在对应动作）。 */
export function workerAction(role: UserRole | undefined, order: ServiceOrder) {
  if (role !== UserRole.WORKER) return undefined;
  return WORKER_ACTIONS[order.status];
}
