import type { DataSource } from 'typeorm';

import { ActivityLogSubscriber } from './activity-log.subscriber';
import type { ActivityLogSubscriberOptions } from './activity-log.types';

interface SubscriberRegistration {
  options: ActivityLogSubscriberOptions;
  subscriber: ActivityLogSubscriber;
}

const registrations = new WeakMap<DataSource, SubscriberRegistration>();

export function registerActivityLogSubscriber(
  dataSource: DataSource,
  options: ActivityLogSubscriberOptions,
): ActivityLogSubscriber {
  if (!dataSource.isInitialized) {
    throw new Error('activitylog: register the TypeORM subscriber after DataSource initialization');
  }
  if (dataSource.subscribers.some((subscriber) => subscriber instanceof ActivityLogSubscriber)) {
    throw new Error('activitylog: a TypeORM activity subscriber is already registered for this DataSource');
  }

  const subscriber = new ActivityLogSubscriber(options);
  dataSource.subscribers.push(subscriber);
  registrations.set(dataSource, { options, subscriber });
  return subscriber;
}

export function getActivityLogSubscriberOptions(
  dataSource: DataSource,
): ActivityLogSubscriberOptions | undefined {
  const registration = registrations.get(dataSource);
  return registration !== undefined && dataSource.subscribers.includes(registration.subscriber)
    ? registration.options
    : undefined;
}
