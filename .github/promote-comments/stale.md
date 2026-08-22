`/promote` refused — this branch is behind `__BASE__`. Rebase locally (your commits stay signed) and force-push, then comment `/promote` again once checks are green:

```bash
git fetch origin && git rebase origin/__BASE__ && git push --force-with-lease
```
