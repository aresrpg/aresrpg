`/promote` accepted — labeled **promote-requested**. This branch is behind `__BASE__`; rebase locally (your commits stay signed) and force-push, and the queue lands it automatically on the next green run — no need to `/promote` again:

```
git fetch origin && git rebase origin/__BASE__ && git push --force-with-lease
```
