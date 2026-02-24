import { Router, Request, Response } from 'express';
import {
    getNotificationsByUser,
    getNotification,
    deleteAllNotificationsByUser,
} from '../storage/tableStorage';

export const notificationsRouter = Router();

/**
 * GET /api/notifications?userId=<userId>
 * List all notifications for the user.
 */
notificationsRouter.get('/', async (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (!userId) {
        res.status(400).json({ error: 'userId query parameter is required' });
        return;
    }

    try {
        const notifications = await getNotificationsByUser(userId);
        res.json(notifications);
    } catch (err: any) {
        console.error('Error listing notifications:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/notifications/:notificationId?userId=<userId>
 * Get a single notification's full details.
 */
notificationsRouter.get('/:notificationId', async (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    let { notificationId } = req.params;

    notificationId = Array.isArray(req.params.notificationId)
        ? req.params.notificationId[0]
        : req.params.notificationId;
    if (!userId) {
        res.status(400).json({ error: 'userId query parameter is required' });
        return;
    }

    try {
        const notification = await getNotification(userId, notificationId);
        if (!notification) {
            res.status(404).json({ error: 'Notification not found' });
            return;
        }
        res.json(notification);
    } catch (err: any) {
        console.error('Error getting notification:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/notifications?userId=<userId>
 * Delete all notifications for the user.
 */
notificationsRouter.delete('/', async (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (!userId) {
        res.status(400).json({ error: 'userId query parameter is required' });
        return;
    }

    try {
        const count = await deleteAllNotificationsByUser(userId);
        res.json({ deleted: count });
    } catch (err: any) {
        console.error('Error deleting notifications:', err);
        res.status(500).json({ error: err.message });
    }
});
