import { describe, expect, it } from 'vitest';
import { buildCreateFolderPayload, buildMoveWorkflowPayload } from '@/services/n8n-rest-client';

describe('n8n REST client payloads', () => {
  describe('buildCreateFolderPayload', () => {
    it('omits parentFolderId for the project root (n8n rejects null with HTTP 400)', () => {
      expect(buildCreateFolderPayload({ name: 'A' })).toEqual({ name: 'A' });
      expect(buildCreateFolderPayload({ name: 'A', parentFolderId: null })).toEqual({ name: 'A' });
    });

    it('sends the parent folder id when given', () => {
      expect(buildCreateFolderPayload({ name: 'A', parentFolderId: 'f-1' })).toEqual({ name: 'A', parentFolderId: 'f-1' });
    });
  });

  describe('buildMoveWorkflowPayload', () => {
    it('sends the root id "0" instead of null to move to the project root', () => {
      expect(buildMoveWorkflowPayload({ parentFolderId: null })).toEqual({ parentFolderId: '0' });
    });

    it('sends the destination folder id when given', () => {
      expect(buildMoveWorkflowPayload({ parentFolderId: 'f-1' })).toEqual({ parentFolderId: 'f-1' });
    });
  });
});
