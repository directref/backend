import { cvUpload } from '../config/multer';

/** Single-file CV upload middleware. Field name: "cv" */
export const uploadCV = cvUpload.single('cv');
