CREATE DATABASE [ModularEcommerce]
GO
USE [ModularEcommerce]
GO
/****** Object:  Table [dbo].[CartProduct]    Script Date: 28/11/2025 15:49:13 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[CartProduct](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[CustomerId] [int] NOT NULL,
	[ProductId] [int] NOT NULL,
	[Quantity] [int] NOT NULL,
	[Price] [money] NOT NULL,
	[Total] [money] NOT NULL,
 CONSTRAINT [PK_CartProduct] PRIMARY KEY CLUSTERED 
(
	[Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Category]    Script Date: 28/11/2025 15:49:13 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Category](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Code] [varchar](50) NOT NULL,
	[Name] [nvarchar](100) NOT NULL,
 CONSTRAINT [PK_Category] PRIMARY KEY CLUSTERED 
(
	[Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[Product]    Script Date: 28/11/2025 15:49:13 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Product](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Code] [varchar](50) NOT NULL,
	[Name] [nvarchar](100) NOT NULL,
	[Description] [nvarchar](400) NULL,
	[Price] [money] NOT NULL,
	[CategoryId] [int] NULL,
 CONSTRAINT [PK_Product] PRIMARY KEY CLUSTERED 
(
	[Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY]
GO
/****** Object:  Table [dbo].[ProductReview]    Script Date: 28/11/2025 15:49:13 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[ProductReview](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[ProductId] [int] NOT NULL,
	[Stars] [tinyint] NOT NULL,
	[Message] [nvarchar](400) NOT NULL,
 CONSTRAINT [PK_ProductReview] PRIMARY KEY CLUSTERED 
(
	[Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY]
GO
SET IDENTITY_INSERT [dbo].[CartProduct] ON 
GO
INSERT [dbo].[CartProduct] ([Id], [CustomerId], [ProductId], [Quantity], [Price], [Total]) VALUES (3005, 1, 1, 1, 150.0000, 150.0000)
GO
SET IDENTITY_INSERT [dbo].[CartProduct] OFF
GO
SET IDENTITY_INSERT [dbo].[Category] ON 
GO
INSERT [dbo].[Category] ([Id], [Code], [Name]) VALUES (1, N'SCA', N'Scarpe')
GO
INSERT [dbo].[Category] ([Id], [Code], [Name]) VALUES (2, N'CAP', N'Cappelli')
GO
INSERT [dbo].[Category] ([Id], [Code], [Name]) VALUES (3, N'PAN', N'Pantaloni')
GO
SET IDENTITY_INSERT [dbo].[Category] OFF
GO
SET IDENTITY_INSERT [dbo].[Product] ON 
GO
INSERT [dbo].[Product] ([Id], [Code], [Name], [Description], [Price], [CategoryId]) VALUES (1, N'SCA1', N'Scarpe da trail', N'Scarpe da trail 123', 150.0000, 1)
GO
INSERT [dbo].[Product] ([Id], [Code], [Name], [Description], [Price], [CategoryId]) VALUES (2, N'SCA2', N'Scarpe da running', N'Scarpe da running', 160.0000, 1)
GO
INSERT [dbo].[Product] ([Id], [Code], [Name], [Description], [Price], [CategoryId]) VALUES (3, N'CAP1', N'Cappello a tesa larga', N'Cappello a tesa larga', 89.0000, 2)
GO
INSERT [dbo].[Product] ([Id], [Code], [Name], [Description], [Price], [CategoryId]) VALUES (4, N'CAP2', N'Berretto tattico', N'Berretto tattico', 75.0000, 2)
GO
INSERT [dbo].[Product] ([Id], [Code], [Name], [Description], [Price], [CategoryId]) VALUES (5, N'PAN1', N'Pantalone mimetico', N'Pantalone mimetico', 59.0000, 3)
GO
INSERT [dbo].[Product] ([Id], [Code], [Name], [Description], [Price], [CategoryId]) VALUES (6, N'PAN1', N'Pantalone da lavoro', N'Pantalone da lavoro', 49.0000, 3)
GO
SET IDENTITY_INSERT [dbo].[Product] OFF
GO
ALTER TABLE [dbo].[CartProduct]  WITH CHECK ADD  CONSTRAINT [FK_CartProduct_Product] FOREIGN KEY([ProductId])
REFERENCES [dbo].[Product] ([Id])
GO
ALTER TABLE [dbo].[CartProduct] CHECK CONSTRAINT [FK_CartProduct_Product]
GO
ALTER TABLE [dbo].[Product]  WITH CHECK ADD  CONSTRAINT [FK_Product_Category] FOREIGN KEY([CategoryId])
REFERENCES [dbo].[Category] ([Id])
GO
ALTER TABLE [dbo].[Product] CHECK CONSTRAINT [FK_Product_Category]
GO
