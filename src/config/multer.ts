import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { env } from './env';
import { AppError } from '../middleware/errorHandler';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dest = path.join(env.UPLOADS_DIR, 'cvs');
    cb(null, dest);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  },
});

export const cvUpload = multer({
  storage,
  limits: {
    fileSize: env.MAX_CV_SIZE_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF and Word documents are accepted'));
    }
  },
});
