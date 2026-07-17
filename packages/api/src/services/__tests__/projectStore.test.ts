import { describe, it, expect } from 'vitest';
import {
  createProject,
  getProjectByApiKey,
  getProjectById,
  listProjectsForUser,
  deleteProjectForUser,
} from '../projectStore.js';
import { findOrCreateUser } from '../userStore.js';

describe('projectStore', () => {
  describe('createProject', () => {
    it('should create an ownerless project when no userId is given (CLI script path)', () => {
      const project = createProject('cli-project');

      expect(project.userId).toBeNull();
      expect(project.apiKey).toMatch(/^proj_/);
    });

    it('should create a project owned by the given user', () => {
      const user = findOrCreateUser('owner1');

      const project = createProject('owned-project', user.id);

      expect(project.userId).toBe(user.id);
    });
  });

  describe('getProjectByApiKey', () => {
    it('should find a project by its api key', () => {
      const created = createProject('findme');

      const found = getProjectByApiKey(created.apiKey);

      expect(found?.id).toBe(created.id);
    });

    it('should return undefined for an unknown key', () => {
      expect(getProjectByApiKey('proj_not_real')).toBeUndefined();
    });
  });

  describe('listProjectsForUser', () => {
    it('should only return projects owned by the given user', () => {
      const alice = findOrCreateUser('alice');
      const bob = findOrCreateUser('bob');
      createProject('alice-project-1', alice.id);
      createProject('alice-project-2', alice.id);
      createProject('bob-project', bob.id);
      createProject('nobody-project'); // ownerless, should appear for neither

      const aliceProjects = listProjectsForUser(alice.id);
      const bobProjects = listProjectsForUser(bob.id);

      expect(aliceProjects).toHaveLength(2);
      expect(aliceProjects.every((p) => p.userId === alice.id)).toBe(true);
      expect(bobProjects).toHaveLength(1);
      expect(bobProjects[0].name).toBe('bob-project');
    });

    it('should return an empty array for a user with no projects', () => {
      const user = findOrCreateUser('lonelyuser');

      expect(listProjectsForUser(user.id)).toEqual([]);
    });
  });

  describe('deleteProjectForUser', () => {
    it('should delete a project owned by the user and return true', () => {
      const user = findOrCreateUser('deleter');
      const project = createProject('to-delete', user.id);

      const result = deleteProjectForUser(project.id, user.id);

      expect(result).toBe(true);
      expect(getProjectById(project.id)).toBeUndefined();
    });

    it('should not delete a project owned by a different user, and return false', () => {
      const owner = findOrCreateUser('realowner');
      const attacker = findOrCreateUser('notowner');
      const project = createProject('protected', owner.id);

      const result = deleteProjectForUser(project.id, attacker.id);

      expect(result).toBe(false);
      expect(getProjectById(project.id)).toBeDefined();
    });

    it('should return false for a non-existent project id', () => {
      const user = findOrCreateUser('someuser');

      expect(deleteProjectForUser('not-a-real-id', user.id)).toBe(false);
    });
  });
});
