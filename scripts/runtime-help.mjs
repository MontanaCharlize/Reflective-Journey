const operation = process.argv[2] === 'test' ? '测试' : '构建'
console.error(`当前目录是已构建的 Windows 运行版，不包含${operation}所需的源码。`)
console.error('直接使用：双击「启动项目.bat」，或运行 npm start。运行版不需要 npm install。')
console.error(`需要${operation}时，请另行解压同版本源码包（源码.zip），在源码目录运行 npm ci，再执行 npm test 或 npm run build。`)
process.exitCode = 1
