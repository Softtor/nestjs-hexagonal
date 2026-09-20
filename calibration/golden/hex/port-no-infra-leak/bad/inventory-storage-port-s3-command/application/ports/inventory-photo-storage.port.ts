import type { S3 } from 'aws-sdk';

export interface InventoryPhotoStoragePort {
  uploadPhoto(command: S3.PutObjectCommandInput): Promise<{ url: string }>;
  deletePhoto(key: string): Promise<void>;
}

export const INVENTORY_PHOTO_STORAGE_PORT = Symbol('InventoryPhotoStoragePort');
