import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { OrderStatus, ServiceStatus, UserRole } from '../../constants/enums';
import { orders, services, users, workers } from '../demo-data';
import { NotificationService } from '../notification/notification.service';
import { WorkerService } from '../worker/worker.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderEntity } from './entities/order.entity';
import { WorkerEntity } from '../worker/entities/worker.entity';
import { assertOrderTransition, INITIAL_ORDER_STATUS } from './order.state-machine';

@Injectable()
export class OrderService {
  constructor(private readonly workerService: WorkerService, private readonly notification: NotificationService) {}

  list(user: { sub: string; role: UserRole }, status?: OrderStatus) {
    return orders.filter((order) => {
      if (status && order.status !== status) return false;
      if (user.role === UserRole.ADMIN) return true;
      if (user.role === UserRole.CUSTOMER) return order.customerId === user.sub;
      const worker = this.workerService.findByUserId(user.sub);
      return worker ? order.workerId === worker.id : false;
    }).map((order) => this.hydrate(order));
  }

  detail(user: { sub: string; role: UserRole }, id: string) {
    const order = this.mustFind(id);
    if (!this.canAccess(user, order)) throw new ForbiddenException('无权查看该订单');
    return this.hydrate(order);
  }

  create(user: { sub: string; role: UserRole }, dto: CreateOrderDto) {
    if (user.role !== UserRole.CUSTOMER) throw new ForbiddenException('仅 Customer 可下单');
    const service = services.find((item) => item.id === dto.serviceItemId);
    if (!service) throw new NotFoundException('服务项目不存在');
    if (service.status !== ServiceStatus.ACTIVE) throw new BadRequestException('服务项目已下架，暂不能下单');
    const order: OrderEntity = {
      id: crypto.randomUUID(),
      orderNo: `HS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(orders.length + 1).padStart(4, '0')}`,
      serviceItemId: dto.serviceItemId,
      customerId: user.sub,
      address: dto.address,
      addressDetail: dto.addressDetail,
      contactPhone: dto.contactPhone,
      scheduledTime: dto.scheduledTime,
      status: INITIAL_ORDER_STATUS,
      totalPrice: dto.totalPrice || service.basePrice,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    orders.unshift(order);
    this.notification.notify({ type: 'order:status_changed', title: '新订单待派单', message: order.orderNo, orderId: order.id });
    return this.hydrate(order);
  }

  updateStatus(user: { sub: string; role: UserRole }, id: string, status: OrderStatus, workerId?: string) {
    const order = this.mustFind(id);
    if (status === OrderStatus.CANCELLED || status === OrderStatus.RATED) {
      throw new BadRequestException(status === OrderStatus.CANCELLED ? '取消订单请使用取消接口' : '评价订单请使用评价接口');
    }
    assertOrderTransition(order.status, status);
    if (status === OrderStatus.ASSIGNED) {
      if (user.role !== UserRole.ADMIN) throw new ForbiddenException('仅 Admin 可派单');
      const worker = workerId ? this.workerService.detail(workerId) : this.workerService.firstOnline();
      order.workerId = worker.id;
    } else if ([OrderStatus.ACCEPTED, OrderStatus.ON_THE_WAY, OrderStatus.IN_PROGRESS, OrderStatus.COMPLETED].includes(status)) {
      const worker = this.workerService.findByUserId(user.sub);
      if (user.role !== UserRole.WORKER || !worker || worker.id !== order.workerId) throw new ForbiddenException('仅订单技师可更新该状态');
      if (status === OrderStatus.COMPLETED) {
        this.applyCompletionStats(order, worker);
      }
    }
    order.status = status;
    order.updatedAt = new Date().toISOString();
    this.notification.notify({
      type: status === OrderStatus.ASSIGNED ? 'order:new_assignment' : status === OrderStatus.ON_THE_WAY ? 'order:worker_arriving' : 'order:status_changed',
      title: '订单状态更新',
      message: `${order.orderNo} 已更新为 ${status}`,
      orderId: order.id,
      userIds: [order.customerId, order.workerId || ''].filter(Boolean)
    });
    return this.hydrate(order);
  }

  rate(user: { sub: string; role: UserRole }, id: string, rating: number, comment: string) {
    const order = this.mustFind(id);
    if (user.role !== UserRole.CUSTOMER || order.customerId !== user.sub) throw new ForbiddenException('仅订单客户可评价');
    assertOrderTransition(order.status, OrderStatus.RATED);
    order.rating = rating;
    order.comment = comment;
    order.status = OrderStatus.RATED;
    order.updatedAt = new Date().toISOString();
    this.recalculateWorkerRating(order.workerId);
    return this.hydrate(order);
  }

  cancel(user: { sub: string; role: UserRole }, id: string, reason: string) {
    const order = this.mustFind(id);
    if (![UserRole.ADMIN, UserRole.CUSTOMER].includes(user.role) || (user.role === UserRole.CUSTOMER && order.customerId !== user.sub)) {
      throw new ForbiddenException('无权取消该订单');
    }
    assertOrderTransition(order.status, OrderStatus.CANCELLED);
    order.status = OrderStatus.CANCELLED;
    order.cancelReason = reason;
    order.updatedAt = new Date().toISOString();
    return this.hydrate(order);
  }

  /**
   * 订单首次进入已完成状态时计入统计：服务项目订单量 +1、技师完成单数 +1。
   * 状态机保证只有 IN_PROGRESS -> COMPLETED 唯一入口，重复提交完工会在流转校验处失败，不会重复累计。
   */
  private applyCompletionStats(order: OrderEntity, worker: WorkerEntity) {
    order.actualDuration = 96;
    worker.totalOrders += 1;
    const service = services.find((item) => item.id === order.serviceItemId);
    if (service) service.orderCount += 1;
  }

  /** 客户首次评价后，按该技师全部已评分订单重新计算平均分 */
  private recalculateWorkerRating(workerId?: string) {
    if (!workerId) return;
    const worker = workers.find((item) => item.id === workerId);
    if (!worker) return;
    const rated = orders.filter((order) => order.workerId === workerId && typeof order.rating === 'number');
    if (!rated.length) return;
    const average = rated.reduce((sum, order) => sum + (order.rating as number), 0) / rated.length;
    worker.rating = Math.round(average * 10) / 10;
  }

  private mustFind(id: string) {
    const order = orders.find((item) => item.id === id);
    if (!order) throw new NotFoundException('订单不存在');
    return order;
  }

  private canAccess(user: { sub: string; role: UserRole }, order: OrderEntity) {
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
