#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 用户目录下的固定安装路径
const INSTALL_DIR = path.join(os.homedir(), 'cloudbase-mcp');
const LOG_FILE = path.join(INSTALL_DIR, 'npm-install.log');

function main() {
	const packageName = process.argv[2];

	if (!packageName) {
		console.error('Usage: npm-global-exec <package-name> [args...]');
		process.exit(1);
	}

	const additionalArgs = process.argv.slice(3);

	// 确保安装目录存在（静默模式）
	ensureInstallDirectorySilent();

	// 在用户目录下安装包（静默模式）
	installPackageLocally(packageName, additionalArgs);
}

function ensureInstallDirectorySilent() {
	if (!fs.existsSync(INSTALL_DIR)) {
		fs.mkdirSync(INSTALL_DIR, { recursive: true });
	}

	// 初始化package.json（如果不存在）
	const packageJsonPath = path.join(INSTALL_DIR, 'package.json');
	if (!fs.existsSync(packageJsonPath)) {
		const packageJson = {
			name: 'cloudbase-mcp-packages',
			version: '1.0.0',
			description: 'User directory for npm-global-exec packages',
			private: true,
			dependencies: {},
		};
		fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
	}

	// 初始化.npmrc文件（如果不存在）
	const npmrcPath = path.join(INSTALL_DIR, '.npmrc');
	if (!fs.existsSync(npmrcPath)) {
		const npmrcContent = 'registry=https://mirrors.cloud.tencent.com/npm/\n';
		fs.writeFileSync(npmrcPath, npmrcContent);
	}
}

function installPackageLocally(packageName, additionalArgs, retryCount = 0) {
	// Windows环境下需要特殊处理npm命令
	const isWindows = process.platform === 'win32';
	const npmCommand = isWindows ? 'npm.cmd' : 'npm';

	// 如果是重试，先清理可能的残留文件
	if (retryCount > 0) {
		cleanupNodeModules();
	}

	// 写入安装开始日志
	const timestamp = new Date().toISOString();
	const retryInfo = retryCount > 0 ? ` (retry ${retryCount})` : '';
	fs.appendFileSync(
		LOG_FILE,
		`\n[${timestamp}] Installing ${packageName}${retryInfo}...\n`
	);

	const npmInstall = spawn(npmCommand, ['install', packageName], {
		cwd: INSTALL_DIR,
		stdio: ['ignore', 'pipe', 'pipe'], // 使用pipe模式捕获输出
		shell: isWindows, // Windows下使用shell执行
	});

	// 将输出写入日志文件
	npmInstall.stdout.on('data', (data) => {
		fs.appendFileSync(LOG_FILE, data);
	});

	npmInstall.stderr.on('data', (data) => {
		fs.appendFileSync(LOG_FILE, data);
	});

	npmInstall.on('close', (code) => {
		const endTimestamp = new Date().toISOString();
		if (code !== 0) {
			// 检查是否是目录不为空的错误，如果是且重试次数少于3次，则重试
			if (retryCount < 3 && shouldRetryInstall(code)) {
				fs.appendFileSync(
					LOG_FILE,
					`[${endTimestamp}] Install failed (exit code: ${code}), retrying...\n`
				);
				setTimeout(() => {
					installPackageLocally(packageName, additionalArgs, retryCount + 1);
				}, 1000 * (retryCount + 1)); // 递增延迟
				return;
			}

			fs.appendFileSync(
				LOG_FILE,
				`[${endTimestamp}] Failed to install ${packageName} (exit code: ${code})\n`
			);
			console.error(
				`Failed to install ${packageName} (exit code: ${code}). Check log: ${LOG_FILE}`
			);
			process.exit(1);
		}

		fs.appendFileSync(
			LOG_FILE,
			`[${endTimestamp}] Successfully installed ${packageName}\n`
		);

		// 查找并执行包的bin文件
		executePackageBin(packageName, additionalArgs);
	});

	npmInstall.on('error', (err) => {
		const errorTimestamp = new Date().toISOString();
		fs.appendFileSync(LOG_FILE, `[${errorTimestamp}] Error: ${err.message}\n`);

		if (err.code === 'ENOENT') {
			console.error('Error: npm command not found! Check log:', LOG_FILE);
		} else {
			console.error(`Error installing ${packageName}. Check log: ${LOG_FILE}`);
		}
		process.exit(1);
	});
}

function shouldRetryInstall(exitCode) {
	// 190: ENOTEMPTY 目录不为空错误
	return exitCode === 190;
}

function cleanupNodeModules() {
	const nodeModulesPath = path.join(INSTALL_DIR, 'node_modules');
	if (fs.existsSync(nodeModulesPath)) {
		try {
			fs.appendFileSync(
				LOG_FILE,
				`[${new Date().toISOString()}] Cleaning up node_modules...\n`
			);
			// 尝试删除node_modules目录（可能失败，但不影响继续）
			fs.rmSync(nodeModulesPath, { recursive: true, force: true });
		} catch (err) {
			fs.appendFileSync(
				LOG_FILE,
				`[${new Date().toISOString()}] Cleanup warning: ${err.message}\n`
			);
		}
	}
}

function executePackageBin(packageName, args) {
	// 从包名中提取实际的包名（去掉版本号）
	let actualPackageName;
	if (packageName.startsWith('@')) {
		// 处理scoped包名，如 @cloudbase/cloudbase-mcp@latest
		const lastAtIndex = packageName.lastIndexOf('@');
		if (lastAtIndex > 0) {
			// 有版本号的情况，取最后一个@之前的部分
			actualPackageName = packageName.substring(0, lastAtIndex);
		} else {
			// 没有版本号的情况
			actualPackageName = packageName;
		}
	} else {
		// 处理普通包名，如 cowsay@1.6.0
		actualPackageName = packageName.split('@')[0];
	}

	// 查找包的package.json
	const packageJsonPath = path.join(
		INSTALL_DIR,
		'node_modules',
		actualPackageName,
		'package.json'
	);

	if (!fs.existsSync(packageJsonPath)) {
		console.error(
			`Package ${actualPackageName} not found at ${packageJsonPath}`
		);
		process.exit(1);
	}

	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

	// 获取bin字段
	let binPath;
	if (typeof packageJson.bin === 'string') {
		binPath = packageJson.bin;
	} else if (packageJson.bin && typeof packageJson.bin === 'object') {
		// 如果bin是对象，使用包名作为key，或使用第一个
		binPath =
			packageJson.bin[actualPackageName] || Object.values(packageJson.bin)[0];
	} else {
		console.error(`No bin field found in ${actualPackageName}`);
		process.exit(1);
	}

	// 构建完整的bin文件路径
	const fullBinPath = path.join(
		INSTALL_DIR,
		'node_modules',
		actualPackageName,
		binPath
	);

	if (!fs.existsSync(fullBinPath)) {
		fs.appendFileSync(
			LOG_FILE,
			`[${new Date().toISOString()}] Bin file not found: ${fullBinPath}\n`
		);
		console.error(`Bin file not found: ${fullBinPath}`);
		process.exit(1);
	}

	// 记录执行信息到日志文件（而不是console输出）
	fs.appendFileSync(
		LOG_FILE,
		`[${new Date().toISOString()}] Executing ${actualPackageName}...\n`
	);

	// 执行bin文件
	const childProcess = spawn('node', [fullBinPath, ...args], {
		stdio: 'inherit',
	});

	childProcess.on('close', (code) => {
		process.exit(code);
	});

	childProcess.on('error', (err) => {
		console.error(`Error executing ${actualPackageName}:`, err);
		process.exit(1);
	});
}

main();
