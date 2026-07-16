export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedApiResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}
