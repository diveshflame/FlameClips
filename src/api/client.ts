import type {
  CaptionSegment,
  CaptionStyle,
  ClipCandidate,
  CropMode,
  ExportJob,
  ProcessingJob,
  ProjectDetailResponse,
  ProjectSummary,
  ProviderStatusInfo,
  SourceAsset,
  SourceValidationResult,
  TargetPlatform,
  UserProfile,
} from '../../shared/types.ts';

const TOKEN_STORAGE_KEY = 'clipforge_auth_token';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  }
  return data;
}

export const api = {
  auth: {
    signup: (payload: { email: string; password: string; name: string }) =>
      request<{ user: UserProfile; token: string }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    login: (payload: { email: string; password: string }) =>
      request<{ user: UserProfile; token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    demo: () =>
      request<{ user: UserProfile; token: string }>('/api/auth/demo', {
        method: 'POST',
      }),
    logout: () =>
      request<{ ok: boolean }>('/api/auth/logout', {
        method: 'POST',
      }),
    me: () => request<{ user: UserProfile }>('/api/auth/me'),
    updateSettings: (payload: {
      name?: string;
      defaultPlatforms?: TargetPlatform[];
      defaultCaptionPreset?: UserProfile['defaultCaptionPreset'];
    }) =>
      request<{ user: UserProfile }>('/api/auth/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    deleteAccount: () =>
      request<{ deleted: boolean }>('/api/auth/account', {
        method: 'DELETE',
      }),
  },

  sources: {
    validateUrl: (url: string) =>
      request<SourceValidationResult>('/api/sources/validate', {
        method: 'POST',
        body: JSON.stringify({ url }),
      }),
  },

  projects: {
    list: () => request<{ projects: ProjectSummary[] }>('/api/projects'),
    create: (payload: {
      title: string;
      description?: string;
      targetPlatforms: TargetPlatform[];
      preferredMinSec?: number;
      preferredMaxSec?: number;
      defaultCaptionPreset?: UserProfile['defaultCaptionPreset'];
    }) =>
      request<{ project: ProjectSummary }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    get: (id: string) => request<ProjectDetailResponse>(`/api/projects/${id}`),
    update: (
      id: string,
      payload: Partial<{
        title: string;
        description: string;
        targetPlatforms: TargetPlatform[];
        preferredMinSec: number;
        preferredMaxSec: number;
        defaultCaptionPreset: UserProfile['defaultCaptionPreset'];
      }>
    ) =>
      request<{ project: ProjectSummary }>(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    delete: (id: string) =>
      request<{ deleted: boolean }>(`/api/projects/${id}`, {
        method: 'DELETE',
      }),
    useSample: (id: string) =>
      request<{ asset: SourceAsset }>(`/api/projects/${id}/use-sample`, {
        method: 'POST',
      }),
    uploadVideo: (
      projectId: string,
      file: File,
      options: { rightsConfirmed: boolean; sourceUrl?: string; metadataTitle?: string },
      onProgress?: (pct: number) => void
    ): Promise<{ asset: SourceAsset }> =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/projects/${projectId}/upload`);
        xhr.withCredentials = true;
        const token = getStoredToken();
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable && onProgress) {
            onProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };

        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText || '{}') as {
              asset?: SourceAsset;
              error?: string;
            };
            if (xhr.status >= 200 && xhr.status < 300 && data.asset) {
              resolve({ asset: data.asset });
            } else {
              reject(new ApiError(data.error || `Upload failed (${xhr.status})`, xhr.status));
            }
          } catch {
            reject(new ApiError('Unexpected upload response from server', xhr.status));
          }
        };

        xhr.onerror = () => reject(new ApiError('Network error during upload', 0));

        const form = new FormData();
        form.append('file', file);
        form.append('rightsConfirmed', String(options.rightsConfirmed));
        if (options.sourceUrl) form.append('sourceUrl', options.sourceUrl);
        if (options.metadataTitle) form.append('metadataTitle', options.metadataTitle);
        xhr.send(form);
      }),
    startAnalysis: (projectId: string, idempotencyKey?: string) =>
      request<{ job: ProcessingJob }>(`/api/projects/${projectId}/analyze`, {
        method: 'POST',
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
        body: JSON.stringify({ idempotencyKey }),
      }),
  },

  jobs: {
    get: (jobId: string) => request<{ job: ProcessingJob }>(`/api/jobs/${jobId}`),
    cancel: (jobId: string) =>
      request<{ job: ProcessingJob }>(`/api/jobs/${jobId}/cancel`, { method: 'POST' }),
  },

  clips: {
    update: (
      clipId: string,
      payload: Partial<{
        startMs: number;
        endMs: number;
        cropMode: CropMode;
        focalPointX: number;
        burnInCaptions: boolean;
        captionStyle: CaptionStyle;
      }>
    ) =>
      request<{ clip: ClipCandidate }>(`/api/clips/${clipId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    updateCaptions: (
      clipId: string,
      captions: Array<Pick<CaptionSegment, 'startMs' | 'endMs' | 'text' | 'emphasisWord'>>
    ) =>
      request<{ clip: ClipCandidate }>(`/api/clips/${clipId}/captions`, {
        method: 'PUT',
        body: JSON.stringify({ captions }),
      }),
    startExport: (
      clipId: string,
      payload: { targetPlatform: TargetPlatform; burnInCaptions: boolean }
    ) =>
      request<{ export: ExportJob }>(`/api/clips/${clipId}/export`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  exports: {
    get: (exportId: string) => request<{ export: ExportJob }>(`/api/exports/${exportId}`),
    retry: (exportId: string) =>
      request<{ export: ExportJob }>(`/api/exports/${exportId}/retry`, { method: 'POST' }),
  },

  system: {
    providers: () => request<ProviderStatusInfo>('/api/system/providers'),
  },
};
