import { ensureFixtures } from '../../scripts/make-fixtures'

/** 集成测试开始前生成一次夹具;各测试文件并行运行,所以不能由它们自己各生成一遍。 */
export default function setup(): void {
  ensureFixtures()
}
