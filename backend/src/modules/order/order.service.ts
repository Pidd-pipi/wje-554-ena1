import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { OrderStatus, UserRole } from '../../constants/enums';
import { orders, services, users, workers } from '../demo-data';
import { NotificationService } from '../notification/notification.service';
import { WorkerService } from '../worker/worker.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderEntity } from './entities/order.entity';
import {
  Operator,
  canAdvanceOrder,
  canAssignOrder,
  canCancelOrder,
  canCancelStatus,
  canRateOrder,
  canTransit,
  isFirstCompletion,
  orderRuleError,
  OrderAction
} from './order.rules';

const WORKER_FLOW = [OrderStatus.ACCEPTED, OrderStatus.ON_THE_WAY, OrderStatus.IN_PROGRESS, OrderStatus.COMPLETED];

@Injectable()
export class OrderService {
  constructor(private readonly workerService: WorkerService, private readonly notification: NotificationService) {}

  list(user: Operator, status?: OrderStatus) {
    return orders.filter((order) => {
      if (status && order.status !== status) return false;
      if (user.role === UserRole.ADMIN) return true;
      if (user.role === UserRole.CUSTOMER) return order.customerId === user.sub;
      const worker = this.workerService.findByUserId(user.sub);
      return worker ? order.workerId === worker.id : false;
    }).map((order) => this.hydrate(order));
  }

  detail(user: Operator, id: string) {
    const order = this.mustFind(id);
    if (!this.canAccess(user, order)) throw new ForbiddenException('无权查看该订单');
    return this.hydrate(order);
  }

  create(user: Operator, dto: CreateOrderDto) {
    if (user.role !== UserRole.CUSTOMER) throw new ForbiddenException('仅 Customer 可下单');
    const service = services.find((item) => item.id === dto.serviceItemId);
    if (!service) throw new NotFoundException('服务项目不存在');
    const order: OrderEntity = {
      id: crypto.randomUUID(),
      orderNo: `HS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(orders.length + 1).padStart(4, '0')}`,
      serviceItemId: dto.serviceItemId,
      customerId: user.sub,
      address: dto.address,
      addressDetail: dto.addressDetail,
      contactPhone: dto.contactPhone,
      scheduledTime: dto.scheduledTime,
      status: OrderStatus.PENDING,
      totalPrice: dto.totalPrice || service.basePrice,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    // 下单只建单，服务项目订单量在订单首次完工时才累计。
    orders.unshift(order);
    this.notification.notify({ type: 'order:status_changed', title: '新订单待派单', message: order.orderNo, orderId: order.id });
    return this.hydrate(order);
  }

  updateStatus(user: Operator, id: string, status: OrderStatus, workerId?: string) {
    const order = this.mustFind(id);

    // 取消走与 /cancel 完全相同的一套状态与权限判断，避免绕过取消入口。
    if (status === OrderStatus.CANCELLED) {
      return this.cancel(user, id, '状态变更取消');
    }

    const assignedWorker = user.role === UserRole.WORKER ? this.workerService.findByUserId(user.sub) : undefined;
    const ctx = { order, operator: user, assignedWorkerId: assignedWorker?.id, targetStatus: status };

    let action: OrderAction;
    if (status === OrderStatus.ASSIGNED) action = 'assign';
    else if (status === OrderStatus.COMPLETED) action = 'complete';
    else action = 'advance';

    // 先做全部校验，任何失败都不修改订单和统计。
    if (!canTransit(order.status, status)) {
      throw new BadRequestException(orderRuleError(action, ctx));
    }
    if (action === 'assign') {
      if (!canAssignOrder(user, order)) throw new ForbiddenException(orderRuleError('assign', ctx));
      const target = workerId ? this.workerService.detail(workerId) : this.workerService.firstOnline();
      return this.applyAssign(order, target.id);
    }

    if (!WORKER_FLOW.includes(status) || !canAdvanceOrder(user, order, status, assignedWorker?.id)) {
      throw new ForbiddenException(orderRuleError('advance', ctx));
    }
    return this.applyAdvance(order, status);
  }

  rate(user: Operator, id: string, rating: number, comment: string) {
    const order = this.mustFind(id);
    if (!canRateOrder(user, order)) throw new BadRequestException(orderRuleError('rate', { order, operator: user }));

    // 首次评价：先收集统计依赖，再整体落库，失败不留半成品。
    const worker = order.workerId ? workers.find((item) => item.id === order.workerId) : undefined;
    order.rating = rating;
    order.comment = comment;
    order.status = OrderStatus.RATED;
    order.updatedAt = new Date().toISOString();
    if (worker) this.recomputeWorkerRating(worker.id);
    return this.hydrate(order);
  }

  cancel(user: Operator, id: string, reason: string) {
    const order = this.mustFind(id);
    if (!canCancelStatus(order.status)) throw new BadRequestException(orderRuleError('cancel', { order, operator: user }));
    if (!canCancelOrder(user, order)) throw new ForbiddenException(orderRuleError('cancel', { order, operator: user }));
    order.status = OrderStatus.CANCELLED;
    order.cancelReason = reason;
    order.updatedAt = new Date().toISOString();
    return this.hydrate(order);
  }

  private applyAssign(order: OrderEntity, workerId: string) {
    order.workerId = workerId;
    order.status = OrderStatus.ASSIGNED;
    order.updatedAt = new Date().toISOString();
    this.notification.notify({
      type: 'order:new_assignment',
      title: '订单状态更新',
      message: `${order.orderNo} 已更新为 ${OrderStatus.ASSIGNED}`,
      orderId: order.id,
      userIds: [order.customerId, order.workerId || ''].filter(Boolean)
    });
    return this.hydrate(order);
  }

  private applyAdvance(order: OrderEntity, status: OrderStatus) {
    // 首次进入已完成：服务项目订单量、技师完成单数只在这里累计一次。
    if (isFirstCompletion(order, status)) {
      const service = services.find((item) => item.id === order.serviceItemId);
      const worker = order.workerId ? workers.find((item) => item.id === order.workerId) : undefined;
      order.actualDuration = 96;
      order.status = status;
      if (service) service.orderCount += 1;
      if (worker) worker.totalOrders += 1;
    } else {
      order.status = status;
    }
    order.updatedAt = new Date().toISOString();
    this.notification.notify({
      type: status === OrderStatus.ON_THE_WAY ? 'order:worker_arriving' : 'order:status_changed',
      title: '订单状态更新',
      message: `${order.orderNo} 已更新为 ${status}`,
      orderId: order.id,
      userIds: [order.customerId, order.workerId || ''].filter(Boolean)
    });
    return this.hydrate(order);
  }

  /** 按该技师全部已评分订单重新计算平均分（四舍五入保留 1 位）。 */
  private recomputeWorkerRating(workerId: string) {
    const rated = orders.filter((item) => item.workerId === workerId && item.status === OrderStatus.RATED && typeof item.rating === 'number');
    const worker = workers.find((item) => item.id === workerId);
    if (!worker) return;
    worker.rating = rated.length
      ? Math.round((rated.reduce((sum, item) => sum + (item.rating || 0), 0) / rated.length) * 10) / 10
      : worker.rating;
  }

  private mustFind(id: string) {
    const order = orders.find((item) => item.id === id);
    if (!order) throw new NotFoundException('订单不存在');
    return order;
  }

  private canAccess(user: Operator, order: OrderEntity) {
    if (user.role === UserRole.ADMIN) return true;
    if (user.role === UserRole.CUSTOMER) return order.customerId === user.sub;
    const worker = this.workerService.findByUserId(user.sub);
    return worker?.id === order.workerId;
  }

  private hydrate(order: OrderEntity) {
    return {
      ...order,
      serviceItem: services.find((service) => service.id === order.serviceItemId),
      customer: users.find((customer) => customer.id === order.customerId),
      worker: workers.find((worker) => worker.id === order.workerId)
    };
  }
}
