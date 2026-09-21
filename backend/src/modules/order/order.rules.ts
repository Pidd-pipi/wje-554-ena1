import { OrderStatus, UserRole } from '../../constants/enums';
import { OrderEntity } from './entities/order.entity';

export interface Operator {
  sub: string;
  role: UserRole;
}

/**
 * 订单状态机：派单、取单、服务流转、完工、取消的合法路径。
 * 下单、派单、取消和评价入口共享同一张表，任何流转都必须先经过这里校验。
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

/** 技师可以推进的服务节点。 */
const WORKER_NEXT_STATUS: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.ON_THE_WAY,
  OrderStatus.IN_PROGRESS,
  OrderStatus.COMPLETED
];

export type OrderAction = 'create' | 'assign' | 'advance' | 'complete' | 'cancel' | 'rate';

export interface OrderRuleContext {
  order: OrderEntity;
  operator: Operator;
  /** 执行操作的技师实体（用于服务流转时核对订单归属）。 */
  assignedWorkerId?: string;
  targetStatus?: OrderStatus;
}

/** 是否允许按状态机流转（重复提交同一状态不算合法流转）。 */
export function canTransit(from: OrderStatus, to: OrderStatus): boolean {
  return from !== to && ORDER_TRANSITIONS[from].includes(to);
}

/** 是否首次进入已完成（统计只在这一次发生）。 */
export function isFirstCompletion(order: OrderEntity, target: OrderStatus): boolean {
  return target === OrderStatus.COMPLETED && order.status !== OrderStatus.COMPLETED;
}

/** 已完成（含已评价）的订单不能再取消。 */
export function canCancelStatus(status: OrderStatus): boolean {
  return status !== OrderStatus.COMPLETED && status !== OrderStatus.RATED && status !== OrderStatus.CANCELLED;
}

/** 取消权限：管理员可取消任意订单，客户只能取消自己的订单，技师不能取消。 */
export function canCancelOrder(operator: Operator, order: OrderEntity): boolean {
  if (operator.role === UserRole.ADMIN) return true;
  return operator.role === UserRole.CUSTOMER && order.customerId === operator.sub;
}

/** 评价入口：仅订单客户、订单处于已完工、且此前未评价过。 */
export function canRateOrder(operator: Operator, order: OrderEntity): boolean {
  return operator.role === UserRole.CUSTOMER && order.customerId === operator.sub && order.status === OrderStatus.COMPLETED;
}

/** 派单入口：仅管理员、订单仍待派单。 */
export function canAssignOrder(operator: Operator, order: OrderEntity): boolean {
  return operator.role === UserRole.ADMIN && order.status === OrderStatus.PENDING;
}

/** 服务流转入口：仅被派单的技师本人，且目标是技师可推进的节点。 */
export function canAdvanceOrder(operator: Operator, order: OrderEntity, target: OrderStatus, assignedWorkerId?: string): boolean {
  return (
    operator.role === UserRole.WORKER &&
    WORKER_NEXT_STATUS.includes(target) &&
    Boolean(order.workerId) &&
    assignedWorkerId === order.workerId
  );
}

/** 不允许的操作给出明确的失败原因，由入口转成对应 HTTP 异常。 */
export function orderRuleError(action: OrderAction, ctx: OrderRuleContext): string {
  const { order, targetStatus } = ctx;
  switch (action) {
    case 'assign':
      if (order.status !== OrderStatus.PENDING) return `订单当前为${order.status}，不能派单`;
      return '仅管理员可派单';
    case 'advance':
      if (!targetStatus || !WORKER_NEXT_STATUS.includes(targetStatus)) return `订单不能从 ${order.status} 流转到 ${targetStatus}`;
      if (order.status === targetStatus) return `订单已是${order.status}状态，请勿重复提交`;
      if (!ORDER_TRANSITIONS[order.status].includes(targetStatus)) return `订单不能从 ${order.status} 流转到 ${targetStatus}`;
      if (ctx.operator.role !== UserRole.WORKER || !order.workerId || ctx.assignedWorkerId !== order.workerId) return '仅订单技师可更新该状态';
      return '订单状态不允许该操作';
    case 'complete':
      return order.status === OrderStatus.COMPLETED
        ? '订单已完工，请勿重复提交完工'
        : `订单不能从 ${order.status} 直接完工`;
    case 'cancel':
      if (!canCancelStatus(order.status)) {
        if (order.status === OrderStatus.CANCELLED) return '订单已取消，不能重复取消';
        return '订单已完工，不能取消';
      }
      return '无权取消该订单';
    case 'rate':
      if (order.status === OrderStatus.CANCELLED) return '已取消订单不能评价';
      if (order.status === OrderStatus.RATED) return '订单已评价，不能重复评价';
      if (order.status !== OrderStatus.COMPLETED) return '仅已完工订单可评价';
      return '仅订单客户可评价';
    default:
      return '订单状态不允许该操作';
  }
}
