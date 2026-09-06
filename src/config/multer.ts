import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { env } from './env';
import { AppError } from '../middleware/errorHandler';

// PDF only — Word docs can't be previewed inline in a browser (no native
// renderer, unlike PDF) and render inconsistently across Word versions/OSes
// when opened locally. Standardizing on PDF keeps every CV both previewable
// and visually identical wherever it's opened.
const ALLOWED_MIME_TYPES = ['application/pdf'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dest = path.resolve(env.UPLOADS_DIR, 'cvs');
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
      cb(new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF files are accepted'));
    }
  },
});
