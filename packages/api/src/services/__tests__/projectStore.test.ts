import { describe, it, expect } from 'vitest';
import {
  createProject,
  getProjectByApiKey,
  getProjectById,
  listProjectsForOrg,
  deleteProjectForOrg,
} from '../projectStore.js';
import { findOrCreateUser } from '../userStore.js';
import { createOrgForUser } from '../orgStore.js';

describe('projectStore', () => {
  describe('createProject', () => {
    it('should create an ownerless project when no orgId is given (CLI script path)', () => {
      const project = createProject('cli-project');

      expect(project.orgId).toBeNull();
      expect(project.apiKey).toMatch(/^proj_/);
    });

    it('should create a project owned by the given org', () => {
      const user = findOrCreateUser('owner1');
      const org = createOrgForUser(user.id, "owner1's org");

      const project = createProject('owned-project', org.id);

      expect(project.orgId).toBe(org.id);
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

  describe('listProjectsForOrg', () => {
    it('should only return projects owned by the given org', () => {
      const alice = findOrCreateUser('alice');
      const bob = findOrCreateUser('bob');
      const aliceOrg = createOrgForUser(alice.id, "alice's org");
      const bobOrg = createOrgForUser(bob.id, "bob's org");
      createProject('alice-project-1', aliceOrg.id);
      createProject('alice-project-2', aliceOrg.id);
      createProject('bob-project', bobOrg.id);
      createProject('nobody-project'); // ownerless, should appear for neither

      const aliceProjects = listProjectsForOrg(aliceOrg.id);
      const bobProjects = listProjectsForOrg(bobOrg.id);

      expect(aliceProjects).toHaveLength(2);
      expect(aliceProjects.every((p) => p.orgId === aliceOrg.id)).toBe(true);
      expect(bobProjects).toHaveLength(1);
      expect(bobProjects[0].name).toBe('bob-project');
    });

    it('should return an empty array for an org with no projects', () => {
      const user = findOrCreateUser('lonelyuser');
      const org = createOrgForUser(user.id, "lonelyuser's org");

      expect(listProjectsForOrg(org.id)).toEqual([]);
    });
  });

  describe('deleteProjectForOrg', () => {
    it('should delete a project owned by the org and return true', () => {
      const user = findOrCreateUser('deleter');
      const org = createOrgForUser(user.id, "deleter's org");
      const project = createProject('to-delete', org.id);

      const result = deleteProjectForOrg(project.id, org.id);

      expect(result).toBe(true);
      expect(getProjectById(project.id)).toBeUndefined();
    });

    it('should not delete a project owned by a different org, and return false', () => {
      const owner = findOrCreateUser('realowner');
      const attacker = findOrCreateUser('notowner');
      const ownerOrg = createOrgForUser(owner.id, "realowner's org");
      const attackerOrg = createOrgForUser(attacker.id, "notowner's org");
      const project = createProject('protected', ownerOrg.id);

      const result = deleteProjectForOrg(project.id, attackerOrg.id);

      expect(result).toBe(false);
      expect(getProjectById(project.id)).toBeDefined();
    });

    it('should return false for a non-existent project id', () => {
      const user = findOrCreateUser('someuser');
      const org = createOrgForUser(user.id, "someuser's org");

      expect(deleteProjectForOrg('not-a-real-id', org.id)).toBe(false);
    });
  });
});
