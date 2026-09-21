import { Box, Button, Card, CardContent, Grid, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { OrderStatus, UserRole } from '../constants/enums';
import { canCancelOrder, canOrderTransition, canRateOrder } from '../constants/orderFlow';
import { OrderStatusFlow } from '../components/common/OrderStatusFlow';
import { PageHeader } from '../components/common/PageHeader';
import { RatingStars } from '../components/common/RatingStars';
import { StatusBadge } from '../components/common/StatusBadge';
import { useAuthStore } from '../stores/authStore';
import { useOrderStore } from '../stores/orderStore';
import { datetime, money } from '../utils/format';

const workerSteps: [OrderStatus, string][] = [
  [OrderStatus.ACCEPTED, '接单'],
  [OrderStatus.ON_THE_WAY, '出发'],
  [OrderStatus.IN_PROGRESS, '开始服务'],
  [OrderStatus.COMPLETED, '完工']
];

export function OrderDetail() {
  const { id = '' } = useParams();
  const role = useAuthStore((state) => state.user?.role);
  const { current, loadOrder, updateStatus, cancel, rate } = useOrderStore();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('服务准时，沟通顺畅。');

  useEffect(() => { loadOrder(id); }, [id, loadOrder]);

  const actions = useMemo(() => {
    if (!current) return [];
    if (role === UserRole.WORKER) {
      return workerSteps.filter(([next]) => canOrderTransition(current.status, next)).map(([next, label]) => [label, next] as [string, OrderStatus]);
    }
    if (role === UserRole.ADMIN && canOrderTransition(current.status, OrderStatus.ASSIGNED)) return [['派单给默认技师', OrderStatus.ASSIGNED] as [string, OrderStatus]];
    return [];
  }, [current, role]);

  // 失败时全局 Toast 已展示后端返回的失败原因，这里刷新详情，让页面回到真实状态
  const runAction = (action: () => Promise<unknown>) => {
    action().catch(() => loadOrder(id).catch(() => undefined));
  };

  if (!current) return null;

  return (
    <>
      <PageHeader title="订单详情" subtitle={current.orderNo} actions={<StatusBadge value={current.status} />} />
      <Grid container spacing={3}>
        <Grid item xs={12} lg={8}>
          <Card><CardContent>
            <Typography variant="h5">{current.serviceItem.name}</Typography>
            <Typography color="text.secondary">{current.serviceItem.description}</Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} md={6}><Typography>价格：{money(current.totalPrice)}</Typography></Grid>
              <Grid item xs={12} md={6}><Typography>预约：{datetime(current.scheduledTime)}</Typography></Grid>
              <Grid item xs={12}><Typography>地址：{current.address}{current.addressDetail}</Typography></Grid>
              <Grid item xs={12} md={6}><Typography>联系电话：{current.contactPhone}</Typography></Grid>
              <Grid item xs={12} md={6}><Typography>技师：{current.worker?.name || '待派单'}</Typography></Grid>
            </Grid>
            <Box sx={{ my: 4, overflowX: 'auto' }}><OrderStatusFlow status={current.status} /></Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {actions.map(([label, next]) => <Button key={next} variant="contained" onClick={() => runAction(() => updateStatus(current.id, next))}>{label}</Button>)}
              {role !== UserRole.WORKER && canCancelOrder(current.status) && <Button color="error" variant="outlined" onClick={() => runAction(() => cancel(current.id, '用户取消'))}>取消订单</Button>}
            </Stack>
          </CardContent></Card>
        </Grid>
        <Grid item xs={12} lg={4}>
          <Card sx={{ mb: 3 }}><CardContent>
            <Typography variant="h6">地图定位</Typography>
            <Box sx={{ height: 220, mt: 2, borderRadius: 2, bgcolor: '#dfe7de', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>{current.address}</Box>
          </CardContent></Card>
          <Card><CardContent>
            <Typography variant="h6">评价</Typography>
            {canRateOrder(current.status) && role === UserRole.CUSTOMER ? (
              <Stack spacing={2} sx={{ mt: 2 }}>
                <RatingStars value={rating} onChange={setRating} />
                <TextField multiline minRows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
                <Button variant="contained" onClick={() => runAction(() => rate(current.id, rating, comment))}>提交评价</Button>
              </Stack>
            ) : current.rating ? (
              <Stack spacing={1} sx={{ mt: 2 }}><RatingStars value={current.rating} readOnly /><Typography>{current.comment}</Typography></Stack>
            ) : <Typography color="text.secondary" sx={{ mt: 2 }}>完工后客户可评价。</Typography>}
          </CardContent></Card>
        </Grid>
      </Grid>
    </>
  );
}
