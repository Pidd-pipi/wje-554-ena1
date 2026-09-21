import { Box, Button, Card, CardContent, Grid, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import { OrderStatus, UserRole } from '../constants/enums';
import { OrderStatusFlow } from '../components/common/OrderStatusFlow';
import { PageHeader } from '../components/common/PageHeader';
import { RatingStars } from '../components/common/RatingStars';
import { StatusBadge } from '../components/common/StatusBadge';
import { useAuthStore } from '../stores/authStore';
import { useOrderStore } from '../stores/orderStore';
import { datetime, money } from '../utils/format';
import { canAssignOrder, canCancelOrder, canRateOrder, workerAction } from '../utils/orderRules';

export function OrderDetail() {
  const { id = '' } = useParams();
  const user = useAuthStore((state) => state.user);
  const role = user?.role;
  const { current, loadOrder, updateStatus, cancel, rate } = useOrderStore();
  const { enqueueSnackbar } = useSnackbar();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('服务准时，沟通顺畅。');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadOrder(id); }, [id, loadOrder]);

  if (!current) return null;

  const action = workerAction(role, current);
  const showAssign = canAssignOrder(role, current);
  const showCancel = canCancelOrder(role, user?.id, current);
  const showRateForm = canRateOrder(role, user?.id, current);

  const run = async (task: () => Promise<unknown>, success: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await task();
      enqueueSnackbar(success, { variant: 'success' });
    } catch {
      // 失败结果已由全局请求拦截统一提示，这里仅恢复按钮状态。
    } finally {
      setSubmitting(false);
    }
  };

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
              {action && (
                <Button
                  variant="contained"
                  disabled={submitting}
                  onClick={() => run(() => updateStatus(current.id, action.next), `${action.label}成功`)}
                >
                  {action.label}
                </Button>
              )}
              {showAssign && (
                <Button
                  variant="contained"
                  disabled={submitting}
                  onClick={() => run(() => updateStatus(current.id, OrderStatus.ASSIGNED), '派单成功')}
                >
                  派单给默认技师
                </Button>
              )}
              {showCancel && (
                <Button
                  color="error"
                  variant="outlined"
                  disabled={submitting}
                  onClick={() => run(() => cancel(current.id, '用户取消'), '订单已取消')}
                >
                  取消订单
                </Button>
              )}
              {!action && !showAssign && !showCancel && (
                <Typography color="text.secondary">当前状态暂无可执行操作。</Typography>
              )}
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
            {showRateForm ? (
              <Stack spacing={2} sx={{ mt: 2 }}>
                <RatingStars value={rating} onChange={setRating} />
                <TextField multiline minRows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
                <Button variant="contained" disabled={submitting} onClick={() => run(() => rate(current.id, rating, comment), '评价提交成功')}>提交评价</Button>
              </Stack>
            ) : current.rating ? (
              <Stack spacing={1} sx={{ mt: 2 }}><RatingStars value={current.rating} readOnly /><Typography>{current.comment}</Typography></Stack>
            ) : current.status === OrderStatus.CANCELLED ? (
              <Typography color="text.secondary" sx={{ mt: 2 }}>订单已取消，不能评价。</Typography>
            ) : (
              <Typography color="text.secondary" sx={{ mt: 2 }}>完工后客户可评价。</Typography>
            )}
          </CardContent></Card>
        </Grid>
      </Grid>
    </>
  );
}
