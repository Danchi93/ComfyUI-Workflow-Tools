# ComfyUI-Multi-Lora

A ComfyUI custom node for managing multiple LoRAs in a single node.

![preview](images/preview.png)

## Features

- Enable/disable each LoRA with a toggle switch
- Adjust weight per LoRA
- Add notes to each LoRA
- Add/remove LoRAs dynamically

## Installation

Clone into your ComfyUI custom_nodes folder:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Danchi93/ComfyUI-Multi-Lora
```

Restart ComfyUI.

## Usage

Add the **Multi LoRA Loader** node in your workflow. Connect the model input, then use the output as you would a standard LoRA Loader.

---

## 中文介绍

一个用于 ComfyUI 的自定义节点，支持在单个节点中管理多个 LoRA。

### 功能特性

- 每个 LoRA 可单独开关
- 可单独调整每个 LoRA 的权重
- 支持为每个 LoRA 添加备注
- 动态增删 LoRA 条目

### 安装方法

将仓库克隆到 ComfyUI 的 custom_nodes 目录：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Danchi93/ComfyUI-Multi-Lora
```

重启 ComfyUI 即可。

### 使用方法

在工作流中添加 **Multi LoRA Loader** 节点，连接模型输入，输出用法与标准 LoRA Loader 相同。