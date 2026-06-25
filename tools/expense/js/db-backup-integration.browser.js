(async function() {
  const result = document.getElementById('result');

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  try {
    await initDB();
    await replaceDatabaseSnapshot({
      expenses: [],
      tags: [
        { id: 'replace-missing', name: 'Missing parent' },
        { id: 'replace-invalid', name: 'Invalid parent', parentId: 'deleted-group' }
      ],
      settings: [],
      tagGroups: []
    });

    const replaced = await createDatabaseSnapshot();
    const replacedTags = new Map(replaced.tags.map(tag => [tag.id, tag]));
    const replacedGroups = new Set(replaced.tagGroups.map(group => group.id));
    assert(
      replacedTags.get('replace-missing').parentId === 'group-category',
      'replace did not repair a missing parent'
    );
    assert(
      replacedTags.get('replace-invalid').parentId === 'group-uncategorized',
      'replace did not repair an invalid parent'
    );
    assert(
      replacedGroups.has('group-category')
        && replacedGroups.has('group-uncategorized'),
      'replace did not add required groups'
    );

    await applyBackupMergePlan({
      expensesToAdd: [],
      tagsToAdd: [
        { id: 'merge-invalid', name: 'Merge invalid', parentId: 'deleted-group' }
      ],
      tagGroupsToAdd: []
    });

    const merged = await createDatabaseSnapshot();
    const mergedTag = merged.tags.find(tag => tag.id === 'merge-invalid');
    assert(
      mergedTag && mergedTag.parentId === 'group-uncategorized',
      'merge did not atomically repair an invalid parent'
    );

    result.textContent = 'PASS';
  } catch (error) {
    result.textContent = 'FAIL: ' + error.message;
    throw error;
  }
})();
