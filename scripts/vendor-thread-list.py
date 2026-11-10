from pathlib import Path
import re, json, os, argparse
parser = argparse.ArgumentParser(description="Copy BB Thread List dependencies. This overwrites local adaptations; reapply and test them after copying.")
parser.add_argument("bb_checkout", type=Path, help="BB checkout at desktop-v0.49.0 (7b26cae79ec978fafd0a5db0e8517e94f12eb8f4)")
parser.add_argument("--overwrite", action="store_true", help="Confirm replacement of the adapted upstream source")
args = parser.parse_args()
if not args.overwrite:
 parser.error("Pass --overwrite only when ready to reapply the adaptations listed in PROVENANCE.json.")
root=args.bb_checkout.resolve()
source=root/'plugins/thread-list'
output=Path('components/chat-thread-list/upstream').resolve()
shared=root/'packages/shared-ui/src'
icon=root/'packages/plugin-registry/flavors/components/ui/icon.tsx'
seen={}; queue=[source/'app.tsx']
pattern=re.compile(r'((?:from\s+|import\s*\(?\s*)[\"\'])([^\"\']+)([\"\'])')
def resolve(p):
 p=p.resolve()
 if p==shared/'components/ui/icon.tsx': return icon
 for q in [p,p.with_suffix('.ts'),p.with_suffix('.tsx'),p/'index.ts',p/'index.tsx']:
  if q.is_file(): return icon if q==shared/'components/ui/icon.tsx' else q
 raise RuntimeError(f'Missing {p}')
def target(p,name):
 if name.startswith('.'): return resolve(p.parent/name)
 if name.startswith('@/'): return resolve(shared/name[2:])
 return None
def dest(p):
 if p==icon: return output/'ui/components/ui/icon.tsx'
 if p.is_relative_to(source): return output/p.relative_to(source)
 if p.is_relative_to(shared): return output/'ui'/p.relative_to(shared)
 raise RuntimeError(str(p))
while queue:
 p=queue.pop().resolve()
 if p in seen: continue
 seen[p]=dest(p)
 for m in pattern.finditer(p.read_text()):
  q=target(p,m[2])
  if q: queue.append(q)
for p,d in seen.items():
 def rewrite(m):
  q=target(p,m[2])
  if not q: return m[0]
  rel=os.path.relpath(dest(q).with_suffix('.js'),d.parent)
  if not rel.startswith('.'): rel='./'+rel
  return m[1]+rel+m[3]
 d.parent.mkdir(parents=True,exist_ok=True)
 d.write_text(pattern.sub(rewrite,p.read_text()))
(output/'LICENSE').write_text((root/'LICENSE').read_text())
(output/'PROVENANCE.json').write_text(json.dumps({'repository':'https://github.com/get-bb/bb','tag':'desktop-v0.49.0','commit':'7b26cae79ec978fafd0a5db0e8517e94f12eb8f4','adaptations':['Chats-only thread data provider','Preferences RPC forwarding to the installed thread-list plugin','Assignment menu and cross-area bot drag support']},indent=2)+'\n')
external=set()
for d in seen.values():
 for m in pattern.finditer(d.read_text()):
  if not m[2].startswith('.'): external.add(m[2])
print('Copied',len(seen),'files')
print('Packages:',sorted(external))
