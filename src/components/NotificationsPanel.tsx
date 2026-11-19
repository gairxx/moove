import { Bell, CheckCheck, Play, X } from 'lucide-react';
import type { ReleaseNotification } from '../types.ts';
import { MediaPoster } from './MediaPoster.tsx';

interface NotificationsPanelProps {
  notifications: ReleaseNotification[];
  onClose?: () => void;
  onPlayMediaId: (mediaId: string) => void;
  onMarkAllRead: () => void;
  embedded?: boolean;
}

export function NotificationsPanel({
  notifications,
  onClose,
  onPlayMediaId,
  onMarkAllRead,
  embedded = false,
}: NotificationsPanelProps) {
  const unreadCount = notifications.filter((n) => !n.read).length;

  const content = (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Bell className="h-4 w-4 text-[#E11D48]" />
          <h2 className="font-display text-base font-semibold text-white">
            New Release Alerts
          </h2>
          {unreadCount > 0 && (
            <span className="text-xs font-medium tabular-nums text-[#E11D48]">
              {unreadCount} New
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">Mark all read</span>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notifications"
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm text-zinc-400">
            Add series or upcoming releases to your Watchlist to get notified when new episodes arrive.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/10">
          {notifications.map((notif) => (
            <div
              key={notif.id}
              className={`flex items-center gap-4 px-5 py-4 transition-colors ${
                notif.read ? 'opacity-75' : 'bg-white/[0.02]'
              }`}
            >
              <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-[#13151C]">
                <MediaPoster
                  src={notif.posterUrl}
                  alt={notif.title}
                  title={notif.title}
                  className="h-full w-full"
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {!notif.read && (
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[#E11D48]">
                      New
                    </span>
                  )}
                  <span className="text-xs text-zinc-400">{notif.platform}</span>
                </div>
                <p className="mt-0.5 text-sm font-medium text-white line-clamp-1">
                  {notif.headline}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400 line-clamp-1">
                  {notif.detail}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onPlayMediaId(notif.mediaId)}
                aria-label={`Play ${notif.title}`}
                className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg bg-[#E11D48] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#BE123C]"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Play</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#111319]">
        {content}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-start sm:justify-end sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="New Release Notifications"
      onClick={onClose}
    >
      <div
        className="max-h-[82vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-[#111319] shadow-2xl sm:mt-14 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </div>
    </div>
  );
}
